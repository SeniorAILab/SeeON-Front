import { create } from "zustand";
import { fetchActiveAlertSnapshot, mapAlertDto, resolveAlert, type FrontendAlert } from "@/services/api/alertEndpoints";
import { buildSseUrl, isAbsoluteApiUrl } from "@/services/apiClient";
import { buildFreshnessBySpace, listCameras, type SpaceFreshness } from "@/services/api/cameras";
import { dashboardService } from "@/services/dashboardService";
import { recordDashboardDelivery } from "@/services/dashboardReceiptService";
import {
  alertsForFacility,
  createAlertMergeState,
  deriveStatusesFromAlerts,
  isActiveAlert,
  mergeAlertUpdates,
  reconcileActiveAlertSnapshot,
  mergeAlerts,
  type AlertMergeState,
  type AlertUpdateDelta,
} from "@/services/alertMerge";
import { useAuthStore } from "@/stores/authStore";
import { registerFacilityMonitorController, useFacilityStore } from "@/stores/facilityStore";
import type { ConnectionState, DashboardResponse, DashboardSummary, SpaceStatus } from "@/types";

interface MonitorState {
  dashboard: DashboardResponse | null;
  loading: boolean;
  statuses: Record<string, SpaceStatus>;
  connection: ConnectionState;
  lastUpdateAt: string | null;
  running: boolean;
  soundEnabled: boolean;
  start: (facilityId: string, intervalMs?: number) => void;
  reload: () => Promise<void>;
  stop: () => void;
  resolve: (spaceId: string) => Promise<void> | void;
  setSound: (on: boolean) => void;
}

const ALERT_RECONCILE_MS = 60_000;
const CAMERA_REFRESH_MS = 30_000;
const SSE_FALLBACK_MS = 3_000;

interface MonitorRun {
  generation: number;
  facilityId: string;
  stopped: boolean;
  sseHealthy: boolean;
  alertTimer: ReturnType<typeof setTimeout> | null;
  cameraTimer: ReturnType<typeof setTimeout> | null;
  fallbackTimer: ReturnType<typeof setTimeout> | null;
  alertFlight: Promise<void> | null;
  cameraFlight: Promise<void> | null;
  alertCoalesced: boolean;
  cameraCoalesced: boolean;
  eventSource: EventSource | null;
  alertListener: EventListener | null;
  alertUpdatedListener: EventListener | null;
  sessionInvalidListener: EventListener | null;
  visibilityListener: (() => void) | null;
  onlineListener: (() => void) | null;
}

let alertMergeState: AlertMergeState = createAlertMergeState();
let activeFacilityId: string | null = null;
let freshnessBySpace: Record<string, SpaceFreshness> = {};
let currentRun: MonitorRun | null = null;
let nextGeneration = 0;

function isCurrentRun(run: MonitorRun): boolean {
  return (
    currentRun?.generation === run.generation &&
    !run.stopped &&
    activeFacilityId === run.facilityId
  );
}

/** REST 스냅샷 성공만으로는 NORMAL을 주장할 수 없다. SSE가 살아 있어야 한다. */
function connectionAfterRestSuccess(run: MonitorRun): ConnectionState {
  return run.sseHealthy ? "NORMAL" : "RECONNECTING";
}

function jitteredDelay(baseMs: number): number {
  return Math.round(baseMs * (1.05 + Math.random() * 0.05));
}

/**
 * 카메라 조회가 실패하면 직전 신선도를 유지한다. 실행 세대가 바뀐 뒤 도착한
 * 응답은 같은 시설 ID여도 폐기한다.
 */
async function refreshCameraFreshness(run: MonitorRun): Promise<boolean> {
  try {
    const cameras = await listCameras();
    if (!isCurrentRun(run)) return false;
    freshnessBySpace = buildFreshnessBySpace(cameras, Date.now());
    return true;
  } catch {
    return false;
  }
}

/** 알림 기반 status 위에 카메라 신선도를 직교로 덮어씌운다(status는 건드리지 않는다). */
function applyFreshness(statuses: Record<string, SpaceStatus>): Record<string, SpaceStatus> {
  const next: Record<string, SpaceStatus> = {};
  for (const [spaceId, status] of Object.entries(statuses)) {
    const freshness = freshnessBySpace[spaceId];
    next[spaceId] = freshness
      ? { ...status, connection: freshness.connection, lastSeenAt: freshness.lastSeenAt }
      : status;
  }
  return next;
}
// Single funnel for delivery receipts: every alert-arrival path goes through
// here, and alerts from another facility (e.g. a facility-switch race) are
// dropped before they can 404 against the session-scoped backend lookup.
function recordDeliveries(alerts: readonly FrontendAlert[], facilityId: string): void {
  for (const alert of alerts) {
    if (alert.facilityId !== facilityId) continue;
    void recordDashboardDelivery(alert).catch(() => undefined);
  }
}


function clearRunTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer !== null) clearTimeout(timer);
}

function teardownRun(run: MonitorRun): void {
  if (run.stopped) return;
  run.stopped = true;
  clearRunTimer(run.alertTimer);
  clearRunTimer(run.cameraTimer);
  clearRunTimer(run.fallbackTimer);
  run.alertTimer = null;
  run.cameraTimer = null;
  run.fallbackTimer = null;
  run.alertCoalesced = false;
  run.cameraCoalesced = false;

  if (run.eventSource) {
    if (typeof run.eventSource.removeEventListener === "function") {
      if (run.alertListener) run.eventSource.removeEventListener("alert", run.alertListener);
      if (run.alertUpdatedListener) run.eventSource.removeEventListener("alert-updated", run.alertUpdatedListener);
      if (run.sessionInvalidListener) run.eventSource.removeEventListener("session-invalid", run.sessionInvalidListener);
    }
    run.eventSource.onopen = null;
    run.eventSource.onerror = null;
    run.eventSource.close();
  }
  run.eventSource = null;
  run.alertListener = null;
  run.alertUpdatedListener = null;
  run.sessionInvalidListener = null;

  if (run.visibilityListener && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", run.visibilityListener);
  }
  if (run.onlineListener && typeof window !== "undefined") {
    window.removeEventListener("online", run.onlineListener);
  }
  run.visibilityListener = null;
  run.onlineListener = null;
  if (currentRun === run) currentRun = null;
}
function deriveMergedStatuses(
  dashboard: DashboardResponse | null,
  statuses: Record<string, SpaceStatus>,
): Record<string, SpaceStatus> {
  if (!dashboard || !activeFacilityId) return statuses;
  const activeSpaceIds = new Set(dashboard.spaces.filter((space) => space.isActive).map((space) => space.id));
  const activeStatuses = Object.fromEntries(
    Object.entries(statuses).filter(([spaceId]) => activeSpaceIds.has(spaceId)),
  );
  const alerts = alertsForFacility(alertMergeState, activeFacilityId).filter((alert) =>
    activeSpaceIds.has(alert.spaceId),
  );
  return applyFreshness(deriveStatusesFromAlerts(activeStatuses, alerts));
}

// Keep the header summary tallies in sync with the live per-room statuses so an SSE
// alert/alert-updated frame updates the "위험 N건" headline/banner without a reload.
function deriveSummaryFromStatuses(
  base: DashboardSummary,
  statuses: Record<string, SpaceStatus>,
): DashboardSummary {
  let danger = 0;
  let caution = 0;
  let checkNeeded = 0;
  for (const s of Object.values(statuses)) {
    if (s.status === "DANGER") danger += 1;
    else if (s.status === "CAUTION") caution += 1;
    else if (s.status === "CHECK_NEEDED") checkNeeded += 1;
  }
  return {
    ...base,
    danger,
    caution,
    checkNeeded,
    stable: Math.max(0, base.totalSpaces - danger - caution - checkNeeded),
  };
}

function dashboardWithStatuses(
  dashboard: DashboardResponse | null,
  statuses: Record<string, SpaceStatus>,
): DashboardResponse | null {
  if (!dashboard) return dashboard;
  const unacknowledgedEvents = activeFacilityId
    ? alertsForFacility(alertMergeState, activeFacilityId).filter(isActiveAlert)
    : dashboard.unacknowledgedEvents;
  return {
    ...dashboard,
    statuses,
    unacknowledgedEvents,
    summary: {
      ...deriveSummaryFromStatuses(dashboard.summary, statuses),
      unacknowledged: unacknowledgedEvents.length,
    },
  };
}

function publishMergedState(run: MonitorRun): void {
  if (!isCurrentRun(run)) return;
  useMonitorStore.setState((state) => {
    const statuses = deriveMergedStatuses(state.dashboard, state.statuses);
    return {
      dashboard: dashboardWithStatuses(state.dashboard, statuses),
      statuses,
      connection: connectionAfterRestSuccess(run),
      lastUpdateAt: new Date().toISOString(),
    };
  });
}

async function reconcileSnapshot(run: MonitorRun): Promise<void> {
  const alerts = await fetchActiveAlertSnapshot();
  if (!isCurrentRun(run)) return;
  alertMergeState = reconcileActiveAlertSnapshot(alertMergeState, run.facilityId, alerts);
  recordDeliveries(alerts, run.facilityId);
}

function requestAlertSync(run: MonitorRun): Promise<void> {
  if (!isCurrentRun(run)) return Promise.resolve();
  if (run.alertFlight) {
    run.alertCoalesced = true;
    return run.alertFlight;
  }

  const execute = async () => {
    do {
      run.alertCoalesced = false;
      try {
        await reconcileSnapshot(run);
        publishMergedState(run);
      } catch {
        if (isCurrentRun(run) && !run.sseHealthy) {
          useMonitorStore.setState({ connection: "RECONNECTING" });
        }
      }
    } while (isCurrentRun(run) && run.alertCoalesced);
  };
  const flight = execute().finally(() => {
    if (run.alertFlight === flight) run.alertFlight = null;
  });
  run.alertFlight = flight;
  return flight;
}

function requestCameraSync(run: MonitorRun): Promise<void> {
  if (!isCurrentRun(run)) return Promise.resolve();
  if (run.cameraFlight) {
    run.cameraCoalesced = true;
    return run.cameraFlight;
  }

  const execute = async () => {
    do {
      run.cameraCoalesced = false;
      if (await refreshCameraFreshness(run)) publishMergedState(run);
    } while (isCurrentRun(run) && run.cameraCoalesced);
  };
  const flight = execute().finally(() => {
    if (run.cameraFlight === flight) run.cameraFlight = null;
  });
  run.cameraFlight = flight;
  return flight;
}

function scheduleAlertReconciliation(run: MonitorRun): void {
  if (!isCurrentRun(run) || run.alertTimer !== null) return;
  run.alertTimer = setTimeout(() => {
    run.alertTimer = null;
    void requestAlertSync(run).finally(() => scheduleAlertReconciliation(run));
  }, jitteredDelay(ALERT_RECONCILE_MS));
}

function scheduleCameraRefresh(run: MonitorRun): void {
  if (!isCurrentRun(run) || run.cameraTimer !== null) return;
  run.cameraTimer = setTimeout(() => {
    run.cameraTimer = null;
    void requestCameraSync(run).finally(() => scheduleCameraRefresh(run));
  }, jitteredDelay(CAMERA_REFRESH_MS));
}

function cancelFallback(run: MonitorRun): void {
  clearRunTimer(run.fallbackTimer);
  run.fallbackTimer = null;
}

function scheduleFallback(run: MonitorRun): void {
  if (!isCurrentRun(run) || run.sseHealthy || run.fallbackTimer !== null) return;
  run.fallbackTimer = setTimeout(() => {
    run.fallbackTimer = null;
    void requestAlertSync(run).finally(() => scheduleFallback(run));
  }, jitteredDelay(SSE_FALLBACK_MS));
}

function requestImmediateSync(run: MonitorRun): void {
  if (!isCurrentRun(run)) return;
  void requestAlertSync(run);
  void requestCameraSync(run);
}

function eventSourceFor(facilityId: string): EventSource {
  const url = buildSseUrl(facilityId);
  return isAbsoluteApiUrl(url) ? new EventSource(url, { withCredentials: true }) : new EventSource(url);
}

export const useMonitorStore = create<MonitorState>((set, get) => ({
  dashboard: null,
  loading: true,
  statuses: {},
  connection: "NORMAL",
  lastUpdateAt: null,
  running: false,
  soundEnabled: false,

  start: (facilityId, _intervalMs) => {
    if (activeFacilityId === facilityId && get().running) return;
    if (currentRun) teardownRun(currentRun);

    const run: MonitorRun = {
      generation: ++nextGeneration,
      facilityId,
      stopped: false,
      sseHealthy: false,
      alertTimer: null,
      cameraTimer: null,
      fallbackTimer: null,
      alertFlight: null,
      cameraFlight: null,
      alertCoalesced: false,
      cameraCoalesced: false,
      eventSource: null,
      alertListener: null,
      alertUpdatedListener: null,
      sessionInvalidListener: null,
      visibilityListener: null,
      onlineListener: null,
    };
    currentRun = run;
    activeFacilityId = facilityId;
    useFacilityStore.getState().setFacility(facilityId);
    alertMergeState = createAlertMergeState();
    freshnessBySpace = {};
    set({ running: true, loading: true, connection: "RECONNECTING" });

    run.visibilityListener = () => {
      if (document.visibilityState === "visible") requestImmediateSync(run);
    };
    run.onlineListener = () => requestImmediateSync(run);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", run.visibilityListener);
    }
    if (typeof window !== "undefined") window.addEventListener("online", run.onlineListener);
    scheduleAlertReconciliation(run);
    scheduleCameraRefresh(run);

    void dashboardService.getDashboard(facilityId).then(async (dashboard) => {
      if (!isCurrentRun(run)) return;
      alertMergeState = createAlertMergeState(dashboard.unacknowledgedEvents as FrontendAlert[]);
      recordDeliveries(dashboard.unacknowledgedEvents as FrontendAlert[], facilityId);
      const initialStatuses = deriveMergedStatuses(dashboard, dashboard.statuses);
      set({
        dashboard: dashboardWithStatuses(dashboard, initialStatuses),
        statuses: initialStatuses,
      });
      await Promise.all([requestAlertSync(run), requestCameraSync(run)]);
      if (!isCurrentRun(run)) return;
      const statuses = deriveMergedStatuses(dashboard, get().statuses);
      set({
        dashboard: dashboardWithStatuses(dashboard, statuses),
        loading: false,
        statuses,
        connection: connectionAfterRestSuccess(run),
        lastUpdateAt: new Date().toISOString(),
      });
      scheduleAlertReconciliation(run);
      scheduleCameraRefresh(run);
    }).catch(() => {
      if (!isCurrentRun(run)) return;
      set({ loading: false, connection: "RECONNECTING" });
      scheduleAlertReconciliation(run);
      scheduleCameraRefresh(run);
    });

    if (typeof EventSource === "undefined") {
      scheduleFallback(run);
      return;
    }
    const eventSource = eventSourceFor(facilityId);
    run.eventSource = eventSource;
    const markSseHealthy = () => {
      if (!isCurrentRun(run)) return;
      run.sseHealthy = true;
      cancelFallback(run);
      set({ connection: "NORMAL" });
    };
    eventSource.onopen = markSseHealthy;
    run.alertListener = ((event: MessageEvent) => {
      if (!isCurrentRun(run)) return;
      markSseHealthy();
      const alert = mapAlertDto(JSON.parse(event.data));
      alertMergeState = mergeAlerts(alertMergeState, [alert]);
      set((state) => {
        const statuses = deriveMergedStatuses(state.dashboard, state.statuses);
        return {
          dashboard: dashboardWithStatuses(state.dashboard, statuses),
          statuses,
          connection: "NORMAL",
          lastUpdateAt: alert.detectedAt,
        };
      });
      recordDeliveries([alert], facilityId);
    }) as EventListener;
    run.alertUpdatedListener = ((event: MessageEvent) => {
      if (!isCurrentRun(run)) return;
      markSseHealthy();
      const update = JSON.parse(event.data) as AlertUpdateDelta;
      alertMergeState = mergeAlertUpdates(alertMergeState, [update]);
      set((state) => {
        const statuses = deriveMergedStatuses(state.dashboard, state.statuses);
        return {
          dashboard: dashboardWithStatuses(state.dashboard, statuses),
          statuses,
          connection: "NORMAL",
          lastUpdateAt: update.resolvedAt ?? new Date().toISOString(),
        };
      });
    }) as EventListener;
    eventSource.addEventListener("alert", run.alertListener);
    eventSource.addEventListener("alert-updated", run.alertUpdatedListener);
    eventSource.onerror = () => {
      if (!isCurrentRun(run)) return;
      run.sseHealthy = false;
      set({ connection: "RECONNECTING" });
      scheduleFallback(run);
    };
    run.sessionInvalidListener = (() => {
      if (!isCurrentRun(run)) return;
      teardownRun(run);
      alertMergeState = createAlertMergeState();
      activeFacilityId = null;
      useAuthStore.getState().logout().catch(() => {
        useAuthStore.setState({ user: null });
      });
      set({ connection: "DISCONNECTED", running: false, loading: false });
    }) as EventListener;
    eventSource.addEventListener("session-invalid", run.sessionInvalidListener);
  },

  reload: async () => {
    const run = currentRun;
    if (!run || !isCurrentRun(run)) {
      useMonitorStore.setState({ dashboard: null, loading: false, statuses: {} });
      return;
    }
    useMonitorStore.setState({ loading: true });
    const dashboard = await dashboardService.getDashboard(run.facilityId);
    if (!isCurrentRun(run)) return;
    alertMergeState = createAlertMergeState(dashboard.unacknowledgedEvents as FrontendAlert[]);
    recordDeliveries(dashboard.unacknowledgedEvents as FrontendAlert[], run.facilityId);
    const initialStatuses = deriveMergedStatuses(dashboard, dashboard.statuses);
    useMonitorStore.setState({ dashboard: dashboardWithStatuses(dashboard, initialStatuses), statuses: initialStatuses });
    await Promise.all([requestAlertSync(run), requestCameraSync(run)]);
    if (!isCurrentRun(run)) return;
    const statuses = deriveMergedStatuses(dashboard, useMonitorStore.getState().statuses);
    useMonitorStore.setState({
      dashboard: dashboardWithStatuses(dashboard, statuses),
      statuses,
      loading: false,
      connection: connectionAfterRestSuccess(run),
      lastUpdateAt: new Date().toISOString(),
    });
  },

  stop: () => {
    if (currentRun) teardownRun(currentRun);
    alertMergeState = createAlertMergeState();
    activeFacilityId = null;
    freshnessBySpace = {};
    set({ running: false, dashboard: null, loading: false, statuses: {} });
  },

  resolve: async (spaceId) => {
    const run = currentRun;
    if (!run || !isCurrentRun(run)) return;
    const alerts = await fetchActiveAlertSnapshot();
    if (!isCurrentRun(run)) return;
    const alert = alerts
      .filter(
        (item) => item.spaceId === spaceId && item.facilityId === run.facilityId && isActiveAlert(item),
      )
      .sort((a, b) => +new Date(b.detectedAt) - +new Date(a.detectedAt))[0];
    if (!alert) return;
    alertMergeState = mergeAlerts(alertMergeState, alerts.filter((item) => item.facilityId === run.facilityId));
    const resolved = await resolveAlert(alert.id);
    if (!isCurrentRun(run)) return;
    alertMergeState = mergeAlerts(alertMergeState, [resolved]);
    set((state) => {
      const statuses = deriveMergedStatuses(state.dashboard, state.statuses);
      return {
        dashboard: dashboardWithStatuses(state.dashboard, statuses),
        statuses,
        lastUpdateAt: resolved.acknowledgedAt ?? resolved.detectedAt,
      };
    });
  },
  setSound: (on) => set({ soundEnabled: on }),
}));

registerFacilityMonitorController({
  stop: () => useMonitorStore.getState().stop(),
  start: (id) => useMonitorStore.getState().start(id),
});
