import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { DashboardResponse, Space, SpaceStatus } from "@/types";
const SCOPED_FACILITY_ID = "fac_happy_nokyang";
const activeSpace: Space = {
  id: "sp_201",
  facilityId: SCOPED_FACILITY_ID,
  floorId: "floor_2",
  name: "201호",
  type: "ROOM",
  capacity: 1,
  isActive: true,
  provisioningSource: "PRODUCT",
};



function okJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const alertDto = {
  alertSeq: "10",
  id: "alert_201",
  facilityId: SCOPED_FACILITY_ID,
  residentId: null,
  cameraId: "cam_sp_201",
  spaceId: "sp_201",
  room: "201호",
  type: "bed-exit",
  probability: 0.92,
  detectedAt: "2026-06-22T01:00:00.000Z",
  status: "NEW",
};

const newerAlertDto = {
  ...alertDto,
  alertSeq: "10",
  id: "alert_newer",
  detectedAt: "2026-06-22T01:10:00.000Z",
  status: "NEW",
};

const olderResolvedAlertDto = {
  ...alertDto,
  alertSeq: "9",
  id: "alert_older",
  detectedAt: "2026-06-22T01:09:00.000Z",
  status: "RESOLVED",
};

function alertDtoWith(overrides: Partial<typeof alertDto> = {}) {
  return { ...alertDto, ...overrides };
}

type CameraDto = {
  id: string;
  facilityId: string;
  spaceId: string;
  online: boolean;
  lastSeenAt: string | null;
};

/** 프로덕션과 같은 함정: online=true인데 lastSeenAt은 한참 전. */
const staleCameraDto: CameraDto = {
  id: "cam_sp_201",
  facilityId: SCOPED_FACILITY_ID,
  spaceId: "sp_201",
  online: true,
  lastSeenAt: "2026-06-20T00:00:00.000Z",
};

function dashboardFetch(
  alerts: unknown[] = [],
  spaces: Space[] = [activeSpace],
  cameras: CameraDto[] = []
) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) {
      return okJsonResponse({
        id: "user-1",
        email: "staff@sen.ai",
        nickname: "직원",
        role: "STAFF",
        facilityId: SCOPED_FACILITY_ID,
      });
    }
    const facilityMatch = url.match(/\/facilities\/([^/?]+)$/);
    if (facilityMatch) {
      const id = decodeURIComponent(facilityMatch[1]);
      return okJsonResponse({
        id,
        name: "행복요양원 녹양점",
        address: "경기도 의정부시",
        phone: "031-123-4567",
      });
    }
    if (url.endsWith("/cameras")) return okJsonResponse(cameras);
    if (url.endsWith("/floors")) return okJsonResponse([]);
    if (url.endsWith("/spaces")) return okJsonResponse(spaces);
    if ((url.endsWith("/alerts") || url.endsWith("/alerts?status=NEW")) && !init?.method) return okJsonResponse(alerts);
    throw new Error(`Unexpected request ${url}`);
  });
}

function stubEventSource() {
  let alertListener: ((event: MessageEvent) => void) | null = null;
  const close = vi.fn();
  vi.stubGlobal(
    "EventSource",
    vi.fn().mockImplementation(() => ({
      addEventListener: vi.fn((type: string, handler: (event: MessageEvent) => void) => {
        if (type === "alert") alertListener = handler;
      }),
      close,
    }))
  );
  return (data: unknown) => alertListener?.(new MessageEvent("alert", { data: JSON.stringify(data) }));
}

const dangerStatus: SpaceStatus = {
  id: "status-sp_201",
  spaceId: "sp_201",
  peopleCount: 0,
  movementLevel: "HIGH",
  fallRiskLevel: "HIGH",
  status: "DANGER",
  aiSummary: "침상 이탈이 감지되었습니다.",
  lastDetectedAt: "2026-06-22T01:00:00.000Z",
  connection: "LIVE",
  lastSeenAt: "2026-08-03T11:59:30.000Z",
  alertStatus: "SENT",
  bedsideActivity: true,
  emergency: true,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function storeSignal<T>(
  store: { getState: () => T; subscribe: (listener: (state: T) => void) => () => void },
  predicate: (state: T) => boolean,
): Promise<void> {
  if (predicate(store.getState())) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out awaiting monitor store state"));
    }, 1_000);
    const unsubscribe = store.subscribe((state) => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

function dashboardFor(
  facilityId: string,
  statuses: Record<string, SpaceStatus> = {},
  spaces: Space[] = [{ ...activeSpace, facilityId }],
): DashboardResponse {
  return {
    facility: {
      id: facilityId,
      name: facilityId,
      address: "Seoul",
      phone: "02-0000-0000",
    },
    floors: [],
    spaces,
    statuses,
    summary: {
      totalSpaces: Object.keys(statuses).length,
      stable: Object.values(statuses).filter((status) => status.status === "STABLE").length,
      caution: Object.values(statuses).filter((status) => status.status === "CAUTION").length,
      danger: Object.values(statuses).filter((status) => status.status === "DANGER").length,
      checkNeeded: Object.values(statuses).filter((status) => status.status === "CHECK_NEEDED").length,
      unacknowledged: 0,
    },
    unacknowledgedEvents: [],
  };
}

describe("monitorStore live alert merge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("@/services/dashboardService");
  });

  it("keeps one EventSource when start is called twice for the same facility", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "EventSource",
      vi.fn().mockImplementation(() => ({
        addEventListener: vi.fn(),
        close,
      }))
    );
    vi.stubGlobal("fetch", dashboardFetch());

    const { useMonitorStore } = await import("./monitorStore");
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 60_000);
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 60_000);

    expect(EventSource).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();

    useMonitorStore.getState().stop();
  });

  it("closes the prior EventSource when start changes facility", async () => {
    const closes: ReturnType<typeof vi.fn>[] = [];
    vi.stubGlobal(
      "EventSource",
      vi.fn().mockImplementation(() => {
        const close = vi.fn();
        closes.push(close);
        return {
          addEventListener: vi.fn(),
          close,
        };
      })
    );
    vi.stubGlobal("fetch", dashboardFetch());

    const { useMonitorStore } = await import("./monitorStore");
    useMonitorStore.getState().start("facility-a", 60_000);
    useMonitorStore.getState().start("facility-b", 60_000);

    expect(EventSource).toHaveBeenCalledTimes(2);
    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(closes[1]).not.toHaveBeenCalled();

    useMonitorStore.getState().stop();
  });

  it("useRealtimeSpaceStatus cleans up EventSource on facility change and unmount", async () => {
    const closes: ReturnType<typeof vi.fn>[] = [];
    vi.stubGlobal(
      "EventSource",
      vi.fn().mockImplementation(() => {
        const close = vi.fn();
        closes.push(close);
        return {
          addEventListener: vi.fn(),
          close,
        };
      })
    );
    vi.stubGlobal("fetch", dashboardFetch());

    const { useRealtimeSpaceStatus } = await import("@/features/monitor/hooks/useRealtimeSpaceStatus");
    const { rerender, unmount } = renderHook(
      ({ facilityId }) => useRealtimeSpaceStatus(facilityId, []),
      { initialProps: { facilityId: "facility-a" } }
    );

    rerender({ facilityId: "facility-b" });
    expect(EventSource).toHaveBeenCalledTimes(2);
    expect(closes[0]).toHaveBeenCalledTimes(1);

    unmount();
    expect(closes[1]).toHaveBeenCalledTimes(1);
  });

  it("does not let a delayed dashboard response from a previous facility overwrite the active facility", async () => {
    const facilityA = deferred<DashboardResponse>();
    const facilityBDashboard = dashboardFor("facility-b", {});
    const getDashboard = vi.fn((facilityId: string) =>
      facilityId === "facility-a" ? facilityA.promise : Promise.resolve(facilityBDashboard)
    );
    vi.doMock("@/services/dashboardService", () => ({
      dashboardService: { getDashboard },
    }));
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("fetch", dashboardFetch());

    const { useMonitorStore } = await import("./monitorStore");
    const facilityBReady = storeSignal(
      useMonitorStore,
      (state) => state.dashboard?.facility.id === "facility-b",
    );
    useMonitorStore.getState().start("facility-a", 60_000);
    useMonitorStore.getState().start("facility-b", 60_000);
    await facilityBReady;
    expect(useMonitorStore.getState().dashboard?.facility.id).toBe("facility-b");
    expect(useMonitorStore.getState().statuses).toEqual({});

    facilityA.resolve(dashboardFor("facility-a", { sp_201: dangerStatus }));
    await Promise.resolve();
    await Promise.resolve();

    expect(useMonitorStore.getState().dashboard?.facility.id).toBe("facility-b");
    expect(useMonitorStore.getState().statuses).toEqual({});

    useMonitorStore.getState().stop();
  });
  it("keeps danger when an older resolved alert arrives after a newer active alert", async () => {
    const sendMessage = stubEventSource();
    vi.stubGlobal("fetch", dashboardFetch());

    const { useMonitorStore } = await import("./monitorStore");
    const dashboardReady = storeSignal(useMonitorStore, (state) => state.dashboard !== null);
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 60_000);
    await dashboardReady;

    sendMessage(newerAlertDto);
    sendMessage(olderResolvedAlertDto);

    expect(useMonitorStore.getState().statuses.sp_201).toMatchObject({
      status: "DANGER",
      alertStatus: "PENDING",
      lastDetectedAt: newerAlertDto.detectedAt,
      emergency: false,
    });

    useMonitorStore.getState().stop();
  });

  it("keeps danger from another active alert when resolving an older alert", async () => {
    const olderActive = alertDtoWith({ id: "alert_older", alertSeq: "9", detectedAt: "2026-06-22T01:10:00.000Z" });
    const newerActive = alertDtoWith({ id: "alert_newer", alertSeq: "10", detectedAt: "2026-06-22T01:09:00.000Z" });
    const baseFetch = dashboardFetch([olderActive, newerActive]);
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/alerts/alert_older/resolve") && init?.method === "PATCH") {
        return okJsonResponse({ ...olderActive, alertSeq: "11", status: "RESOLVED" });
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useMonitorStore } = await import("./monitorStore");
    const dashboardReady = storeSignal(useMonitorStore, (state) => state.dashboard !== null);
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 60_000);
    await dashboardReady;
    useMonitorStore.setState({ statuses: { sp_201: dangerStatus } });

    await useMonitorStore.getState().resolve("sp_201");

    expect(useMonitorStore.getState().statuses.sp_201).toMatchObject({
      status: "DANGER",
      alertStatus: "PENDING",
      lastDetectedAt: newerActive.detectedAt,
      emergency: false,
    });

    useMonitorStore.getState().stop();
  });

  it("clears danger when resolving the only active alert", async () => {
    const baseFetch = dashboardFetch([alertDto]);
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/alerts/alert_201/resolve") && init?.method === "PATCH") {
        return okJsonResponse({ ...alertDto, alertSeq: "11", status: "RESOLVED" });
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useMonitorStore } = await import("./monitorStore");
    const dashboardReady = storeSignal(useMonitorStore, (state) => state.dashboard !== null);
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 60_000);
    await dashboardReady;
    useMonitorStore.setState({ statuses: { sp_201: dangerStatus } });

    await useMonitorStore.getState().resolve("sp_201");

    expect(useMonitorStore.getState().statuses.sp_201).toMatchObject({
      status: "STABLE",
      alertStatus: "ACKNOWLEDGED",
      emergency: false,
      bedsideActivity: false,
    });
    expect(useMonitorStore.getState().dashboard?.unacknowledgedEvents).toEqual([]);
    expect(useMonitorStore.getState().dashboard?.summary.unacknowledged).toBe(0);

    useMonitorStore.getState().stop();
  });

  it("selects the numeric max alertSeq active alert independent of arrival order", async () => {
    const sendMessage = stubEventSource();
    vi.stubGlobal("fetch", dashboardFetch());

    const { useMonitorStore } = await import("./monitorStore");
    const dashboardReady = storeSignal(useMonitorStore, (state) => state.dashboard !== null);
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 60_000);
    await dashboardReady;

    sendMessage(alertDtoWith({ id: "alert_seq_10", alertSeq: "10", detectedAt: "2026-06-22T01:10:00.000Z" }));
    sendMessage(alertDtoWith({ id: "alert_seq_2", alertSeq: "2", detectedAt: "2026-06-22T01:02:00.000Z" }));

    expect(useMonitorStore.getState().statuses.sp_201.lastDetectedAt).toBe("2026-06-22T01:10:00.000Z");

    useMonitorStore.getState().stop();
  });
  it("recomputes the summary danger tally live from an SSE alert without a reload", async () => {
    const sendMessage = stubEventSource();
    vi.stubGlobal("fetch", dashboardFetch());

    const { useMonitorStore } = await import("./monitorStore");
    const dashboardReady = storeSignal(useMonitorStore, (state) => state.dashboard !== null);
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 60_000);
    await dashboardReady;

    expect(useMonitorStore.getState().dashboard?.summary.danger).toBe(0);

    sendMessage(alertDto);

    expect(useMonitorStore.getState().statuses.sp_201.status).toBe("DANGER");
    expect(useMonitorStore.getState().dashboard?.summary.danger).toBe(1);

    useMonitorStore.getState().stop();
  });

  it("records delivery only after a correlated SSE alert enters the normalized feed", async () => {
    const sendMessage = stubEventSource();
    const baseFetch = dashboardFetch();
    const correlatedAlert = {
      ...alertDto,
      id: "alert_receipt",
      backendEventId: "event_receipt",
      alertSeq: "88",
    };
    const deliveryRequested = deferred<void>();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/dashboard/receipts/delivery") && init?.method === "POST") {
        deliveryRequested.resolve(undefined);
        return new Response(
          JSON.stringify({
            deliveryId: "delivery-88",
            backendEventId: correlatedAlert.backendEventId,
            alertId: correlatedAlert.id,
            alertSeq: correlatedAlert.alertSeq,
            kind: "delivery",
            surface: "normalized-feed",
            observedAt: "2026-07-17T03:00:00.000Z",
            recordedAt: "2026-07-17T03:00:01.000Z",
            duplicate: false,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useMonitorStore } = await import("./monitorStore");
    const dashboardReady = storeSignal(useMonitorStore, (state) => state.dashboard !== null);
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 60_000);
    await dashboardReady;

    sendMessage(correlatedAlert);

    await deliveryRequested.promise;
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/dashboard/receipts/delivery",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"backendEventId":"event_receipt"'),
      }),
    );
    expect(
      useMonitorStore.getState().dashboard?.unacknowledgedEvents,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "alert_receipt",
          backendEventId: "event_receipt",
        }),
      ]),
    );

    useMonitorStore.getState().stop();
  });

  it("keeps inactive-space alerts out of live statuses and summary totals", async () => {
    const inactiveSpace: Space = { ...activeSpace, id: "sp_inactive", isActive: false };
    const inactiveAlert = alertDtoWith({ id: "alert_inactive", spaceId: inactiveSpace.id, alertSeq: "11" });
    vi.stubGlobal("fetch", dashboardFetch([alertDto, inactiveAlert], [activeSpace, inactiveSpace]));

    const { useMonitorStore } = await import("./monitorStore");
    const dashboardReady = storeSignal(useMonitorStore, (state) => state.dashboard !== null);
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 60_000);
    await dashboardReady;

    expect(useMonitorStore.getState().statuses).toMatchObject({ sp_201: { status: "DANGER" } });
    expect(useMonitorStore.getState().statuses).not.toHaveProperty(inactiveSpace.id);
    expect(useMonitorStore.getState().dashboard?.summary).toMatchObject({ totalSpaces: 1, danger: 1 });
    expect(useMonitorStore.getState().dashboard?.unacknowledgedEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: inactiveAlert.id })]),
    );

    useMonitorStore.getState().stop();
  });
});
describe("monitorStore resolve", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("@/services/dashboardService");
  });

  it("patches the backend alert by id and clears the room card danger state", async () => {
    const baseFetch = dashboardFetch([alertDto]);
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/alerts/alert_201/resolve") && init?.method === "PATCH") {
        return okJsonResponse({ ...alertDto, status: "RESOLVED" });
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useMonitorStore } = await import("./monitorStore");
    const dashboardReady = storeSignal(useMonitorStore, (state) => state.dashboard !== null);
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 60_000);
    await dashboardReady;
    useMonitorStore.setState({ statuses: { sp_201: dangerStatus } });

    await useMonitorStore.getState().resolve("sp_201");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/alerts/alert_201/resolve",
      expect.objectContaining({ method: "PATCH", credentials: "include" })
    );
    expect(useMonitorStore.getState().statuses.sp_201).toMatchObject({
      status: "STABLE",
      alertStatus: "ACKNOWLEDGED",
      emergency: false,
      bedsideActivity: false,
    });

    useMonitorStore.getState().stop();
  });
});

describe("sse-independent — REST 성공이 SSE 장애를 덮지 않는다", () => {
  function stubEventSourceWithHandles() {
    const close = vi.fn();
    const handle: {
      onopen?: () => void;
      onerror?: () => void;
    } = {};
    vi.stubGlobal(
      "EventSource",
      vi.fn().mockImplementation(() => {
        const source = {
          addEventListener: vi.fn(),
          close,
          set onopen(fn: () => void) {
            handle.onopen = fn;
          },
          set onerror(fn: () => void) {
            handle.onerror = fn;
          },
        };
        return source;
      })
    );
    return handle;
  }

  it("SSE가 끊긴 뒤 REST 폴링이 성공해도 connection이 NORMAL로 돌아가지 않는다", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal("fetch", dashboardFetch([], [activeSpace], [staleCameraDto]));
    const sse = stubEventSourceWithHandles();

    const { useMonitorStore } = await import("./monitorStore");
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 10);
    sse.onopen?.();
    expect(useMonitorStore.getState().connection).toBe("NORMAL");

    sse.onerror?.();
    expect(useMonitorStore.getState().connection).toBe("RECONNECTING");
    await vi.advanceTimersByTimeAsync(3_150);
    expect(useMonitorStore.getState().connection).toBe("RECONNECTING");

    useMonitorStore.getState().stop();
    vi.useRealTimers();
  });

  it("SSE가 열리기 전에는 REST 성공만으로 NORMAL을 주장하지 않는다", async () => {
    vi.stubGlobal("fetch", dashboardFetch([], [activeSpace], [staleCameraDto]));
    stubEventSourceWithHandles();

    const { useMonitorStore } = await import("./monitorStore");
    const statusReady = storeSignal(useMonitorStore, (state) => state.statuses.sp_201 !== undefined);
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 10);
    await statusReady;
    expect(useMonitorStore.getState().connection).toBe("RECONNECTING");

    useMonitorStore.getState().stop();
  });
});

describe("camera freshness — 죽은 카메라를 정상으로 표시하지 않는다", () => {
  it("online=true라도 lastSeenAt이 오래됐으면 STALE로 실린다", async () => {
    vi.stubGlobal("fetch", dashboardFetch([], [activeSpace], [staleCameraDto]));
    vi.stubGlobal("EventSource", undefined);

    const { useMonitorStore } = await import("./monitorStore");
    const statusReady = storeSignal(
      useMonitorStore,
      (state) => state.statuses.sp_201?.lastSeenAt === staleCameraDto.lastSeenAt,
    );
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 10_000);
    await statusReady;

    const status = useMonitorStore.getState().statuses.sp_201;
    expect(status.connection).toBe("STALE");
    expect(status.lastSeenAt).toBe("2026-06-20T00:00:00.000Z");
    // 위험도는 신선도에 덮이지 않는다.
    expect(status.status).toBe("STABLE");

    useMonitorStore.getState().stop();
  });

  it("카메라가 방금 heartbeat를 보냈으면 LIVE로 실린다", async () => {
    const liveCamera: CameraDto = { ...staleCameraDto, lastSeenAt: new Date().toISOString() };
    vi.stubGlobal("fetch", dashboardFetch([], [activeSpace], [liveCamera]));
    vi.stubGlobal("EventSource", undefined);

    const { useMonitorStore } = await import("./monitorStore");
    const statusReady = storeSignal(
      useMonitorStore,
      (state) => state.statuses.sp_201?.lastSeenAt === liveCamera.lastSeenAt,
    );
    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 10_000);
    await statusReady;

    expect(useMonitorStore.getState().statuses.sp_201.connection).toBe("LIVE");

    useMonitorStore.getState().stop();
  });
});

describe("monitorStore deterministic supervisors", () => {
  type SyntheticSource = {
    onopen: (() => void) | null;
    onerror: (() => void) | null;
    close: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    emit: (type: string, data?: unknown) => void;
    listenerCount: () => number;
  };

  function installSyntheticEventSource(): SyntheticSource[] {
    const sources: SyntheticSource[] = [];
    vi.stubGlobal(
      "EventSource",
      vi.fn().mockImplementation(() => {
        const listeners = new Map<string, Set<(event: Event) => void>>();
        const source: SyntheticSource = {
          onopen: null,
          onerror: null,
          close: vi.fn(),
          addEventListener: vi.fn((type: string, handler: (event: Event) => void) => {
            const handlers = listeners.get(type) ?? new Set();
            handlers.add(handler);
            listeners.set(type, handlers);
          }),
          removeEventListener: vi.fn((type: string, handler: (event: Event) => void) => {
            listeners.get(type)?.delete(handler);
          }),
          emit: (type, data) => {
            const event = data === undefined
              ? new Event(type)
              : new MessageEvent(type, { data: JSON.stringify(data) });
            for (const handler of listeners.get(type) ?? []) handler(event);
          },
          listenerCount: () =>
            [...listeners.values()].reduce((count, handlers) => count + handlers.size, 0),
        };
        sources.push(source);
        return source;
      }),
    );
    return sources;
  }

  function countRequests(fetchMock: ReturnType<typeof dashboardFetch>, suffix: string): number {
    return fetchMock.mock.calls.filter(([input]) => String(input).endsWith(suffix)).length;
  }

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-08-12T00:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("polls alerts at 3s only after SSE failure and cancels fallback on reconnect", async () => {
    const sources = installSyntheticEventSource();
    const fetchMock = dashboardFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { useMonitorStore } = await import("./monitorStore");

    useMonitorStore.getState().start(SCOPED_FACILITY_ID);
    await vi.advanceTimersByTimeAsync(0);
    sources[0].onopen?.();
    const initialAlerts = countRequests(fetchMock, "/alerts?status=NEW");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(initialAlerts);

    sources[0].onerror?.();
    await vi.advanceTimersByTimeAsync(3_149);
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(initialAlerts);
    await vi.advanceTimersByTimeAsync(1);
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(initialAlerts + 1);
    await vi.advanceTimersByTimeAsync(3_150);
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(initialAlerts + 2);

    sources[0].onopen?.();
    await vi.advanceTimersByTimeAsync(3_150);
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(initialAlerts + 2);

    useMonitorStore.getState().stop();
    vi.useRealTimers();
  });

  it("refreshes cameras at 30s and reconciles alerts at 60s on independent jittered schedules", async () => {
    const sources = installSyntheticEventSource();
    const fetchMock = dashboardFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { useMonitorStore } = await import("./monitorStore");

    useMonitorStore.getState().start(SCOPED_FACILITY_ID);
    await vi.advanceTimersByTimeAsync(0);
    sources[0].onopen?.();
    const initialAlerts = countRequests(fetchMock, "/alerts?status=NEW");
    const initialCameras = countRequests(fetchMock, "/cameras");

    await vi.advanceTimersByTimeAsync(31_499);
    expect(countRequests(fetchMock, "/cameras")).toBe(initialCameras);
    await vi.advanceTimersByTimeAsync(1);
    expect(countRequests(fetchMock, "/cameras")).toBe(initialCameras + 1);
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(initialAlerts);

    await vi.advanceTimersByTimeAsync(31_500);
    expect(countRequests(fetchMock, "/cameras")).toBe(initialCameras + 2);
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(initialAlerts + 1);

    useMonitorStore.getState().stop();
    vi.useRealTimers();
  });

  it("applies the upper 10% additive jitter bound when randomness is pinned", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const sources = installSyntheticEventSource();
    const fetchMock = dashboardFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { useMonitorStore } = await import("./monitorStore");

    useMonitorStore.getState().start(SCOPED_FACILITY_ID);
    await vi.advanceTimersByTimeAsync(0);
    sources[0].onopen?.();
    const initialAlerts = countRequests(fetchMock, "/alerts?status=NEW");
    const initialCameras = countRequests(fetchMock, "/cameras");

    await vi.advanceTimersByTimeAsync(32_999);
    expect(countRequests(fetchMock, "/cameras")).toBe(initialCameras);
    await vi.advanceTimersByTimeAsync(1);
    expect(countRequests(fetchMock, "/cameras")).toBe(initialCameras + 1);
    await vi.advanceTimersByTimeAsync(32_999);
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(initialAlerts);
    await vi.advanceTimersByTimeAsync(1);
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(initialAlerts + 1);

    useMonitorStore.getState().stop();
  });

  it("keeps an SSE alert that is causally newer than an in-flight empty REST snapshot", async () => {
    const sources = installSyntheticEventSource();
    const snapshotArmed = deferred<void>();
    const heldSnapshot = deferred<Response>();
    const ttsUpdate = vi.fn();
    vi.doMock("@/features/monitor/services/tts/ttsManager", () => ({
      ttsManager: { update: ttsUpdate },
    }));
    const baseFetch = dashboardFetch();
    let snapshotCalls = 0;
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      if (String(input).endsWith("/alerts?status=NEW")) {
        snapshotCalls += 1;
        if (snapshotCalls === 1) {
          snapshotArmed.resolve(undefined);
          return heldSnapshot.promise;
        }
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { useMonitorStore } = await import("./monitorStore");
    const { buildTTSAlerts, useTTSAlerts } = await import("@/features/monitor/hooks/useTTSAlerts");
    const presentationTransitions: string[][] = [];
    let lastPresentationSignature: string | null = null;
    const unsubscribe = useMonitorStore.subscribe((state) => {
      if (!state.dashboard) return;
      const ids = state.dashboard.unacknowledgedEvents.map((item) => item.id);
      const signature = ids.join("|");
      if (signature === lastPresentationSignature) return;
      lastPresentationSignature = signature;
      presentationTransitions.push(ids);
    });
    const monitor = renderHook(() => {
      const activeAlerts = useMonitorStore((state) => state.dashboard?.unacknowledgedEvents ?? []);
      const ttsAlerts = buildTTSAlerts([activeSpace], {}, [], activeAlerts);
      useTTSAlerts(ttsAlerts, true);
      return activeAlerts;
    });

    useMonitorStore.getState().start(SCOPED_FACILITY_ID);
    await vi.advanceTimersByTimeAsync(0);
    await snapshotArmed.promise;
    sources[0].onopen?.();
    const duringRequest = alertDtoWith({ id: "alert-during-snapshot", alertSeq: "1" });

    act(() => sources[0].emit("alert", duringRequest));
    expect(monitor.result.current.map((item) => item.id)).toEqual([duringRequest.id]);

    heldSnapshot.resolve(okJsonResponse([]));
    await vi.advanceTimersByTimeAsync(0);
    act(() => sources[0].emit("alert", duringRequest));

    expect(monitor.result.current.map((item) => item.id)).toEqual([duringRequest.id]);
    expect(presentationTransitions).toEqual([[], [duringRequest.id]]);
    expect(
      ttsUpdate.mock.calls.filter(([alerts]) =>
        (alerts as Array<{ identity: string }>).some((item) => item.identity === duringRequest.id),
      ),
    ).toHaveLength(1);

    monitor.unmount();
    unsubscribe();
    useMonitorStore.getState().stop();
    vi.doUnmock("@/features/monitor/services/tts/ttsManager");
  });

  it("repairs an SSE-missed alert from the 60s reconciliation snapshot", async () => {
    const sources = installSyntheticEventSource();
    let activeSnapshot = false;
    const baseFetch = dashboardFetch();
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      if (String(input).endsWith("/alerts?status=NEW")) {
        return Promise.resolve(okJsonResponse(activeSnapshot ? [alertDto] : []));
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { useMonitorStore } = await import("./monitorStore");

    useMonitorStore.getState().start(SCOPED_FACILITY_ID);
    await vi.advanceTimersByTimeAsync(0);
    sources[0].onopen?.();
    expect(useMonitorStore.getState().statuses.sp_201.status).toBe("STABLE");

    activeSnapshot = true;
    await vi.advanceTimersByTimeAsync(63_000);
    expect(useMonitorStore.getState().statuses.sp_201.status).toBe("DANGER");

    useMonitorStore.getState().stop();
    vi.useRealTimers();
  });

  it("runs one immediate coalesced sync when the page becomes visible or the browser comes online", async () => {
    const sources = installSyntheticEventSource();
    const fetchMock = dashboardFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { useMonitorStore } = await import("./monitorStore");

    useMonitorStore.getState().start(SCOPED_FACILITY_ID);
    await vi.advanceTimersByTimeAsync(0);
    sources[0].onopen?.();
    const initialAlerts = countRequests(fetchMock, "/alerts?status=NEW");
    const initialCameras = countRequests(fetchMock, "/cameras");

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(initialAlerts);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(initialAlerts + 1);
    expect(countRequests(fetchMock, "/cameras")).toBe(initialCameras + 1);

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(initialAlerts + 2);
    expect(countRequests(fetchMock, "/cameras")).toBe(initialCameras + 2);

    useMonitorStore.getState().stop();
    vi.useRealTimers();
  });

  it("coalesces repeated alert sync triggers without overlapping requests", async () => {
    const sources = installSyntheticEventSource();
    const heldSnapshot = deferred<Response>();
    let activeSnapshotCalls = 0;
    const baseFetch = dashboardFetch();
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      if (String(input).endsWith("/alerts?status=NEW")) {
        activeSnapshotCalls += 1;
        if (activeSnapshotCalls === 2) return heldSnapshot.promise;
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { useMonitorStore } = await import("./monitorStore");

    useMonitorStore.getState().start(SCOPED_FACILITY_ID);
    await vi.advanceTimersByTimeAsync(0);
    sources[0].onopen?.();
    await vi.advanceTimersByTimeAsync(63_000);
    expect(activeSnapshotCalls).toBe(2);

    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    expect(activeSnapshotCalls).toBe(2);

    heldSnapshot.resolve(okJsonResponse([]));
    await vi.advanceTimersByTimeAsync(0);
    expect(activeSnapshotCalls).toBe(3);

    useMonitorStore.getState().stop();
    vi.useRealTimers();
  });

  it("rejects writes from a stopped generation even after restarting the same facility", async () => {
    const sources = installSyntheticEventSource();
    const heldSnapshot = deferred<Response>();
    let activeSnapshotCalls = 0;
    const baseFetch = dashboardFetch();
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      if (String(input).endsWith("/alerts?status=NEW")) {
        activeSnapshotCalls += 1;
        if (activeSnapshotCalls === 2) return heldSnapshot.promise;
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { useMonitorStore } = await import("./monitorStore");

    useMonitorStore.getState().start(SCOPED_FACILITY_ID);
    await vi.advanceTimersByTimeAsync(0);
    sources[0].onopen?.();
    await vi.advanceTimersByTimeAsync(63_000);
    expect(activeSnapshotCalls).toBe(2);

    useMonitorStore.getState().stop();
    useMonitorStore.getState().start(SCOPED_FACILITY_ID);
    await vi.advanceTimersByTimeAsync(0);
    sources[1].onopen?.();
    expect(useMonitorStore.getState().statuses.sp_201.status).toBe("STABLE");

    heldSnapshot.resolve(okJsonResponse([alertDto]));
    await vi.advanceTimersByTimeAsync(0);
    expect(useMonitorStore.getState().statuses.sp_201.status).toBe("STABLE");

    useMonitorStore.getState().stop();
    vi.useRealTimers();
  });

  it("runs exactly one initial alert and camera sync for each facility switch", async () => {
    const sources = installSyntheticEventSource();
    const fetchMock = dashboardFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { useMonitorStore } = await import("./monitorStore");

    useMonitorStore.getState().start("facility-a");
    await vi.advanceTimersByTimeAsync(0);
    sources[0].onopen?.();
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(1);
    expect(countRequests(fetchMock, "/cameras")).toBe(1);

    useMonitorStore.getState().start("facility-b");
    await vi.advanceTimersByTimeAsync(0);
    sources[1].onopen?.();
    expect(countRequests(fetchMock, "/alerts?status=NEW")).toBe(2);
    expect(countRequests(fetchMock, "/cameras")).toBe(2);
    expect(sources[0].close).toHaveBeenCalledTimes(1);

    useMonitorStore.getState().stop();
  });

  it("completion-schedules camera refresh and coalesces triggers while its request is in flight", async () => {
    const sources = installSyntheticEventSource();
    const heldCameras = deferred<Response>();
    let cameraCalls = 0;
    const baseFetch = dashboardFetch();
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      if (String(input).endsWith("/cameras")) {
        cameraCalls += 1;
        if (cameraCalls === 2) return heldCameras.promise;
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { useMonitorStore } = await import("./monitorStore");

    useMonitorStore.getState().start(SCOPED_FACILITY_ID);
    await vi.advanceTimersByTimeAsync(0);
    sources[0].onopen?.();
    await vi.advanceTimersByTimeAsync(31_500);
    expect(cameraCalls).toBe(2);

    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(cameraCalls).toBe(2);

    heldCameras.resolve(okJsonResponse([]));
    await vi.advanceTimersByTimeAsync(0);
    expect(cameraCalls).toBe(3);
    await vi.advanceTimersByTimeAsync(31_499);
    expect(cameraCalls).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(cameraCalls).toBe(4);

    useMonitorStore.getState().stop();
  });

  it("reconciles the same alert from SSE and polling fallback into one UI notification", async () => {
    const sources = installSyntheticEventSource();
    let snapshot: unknown[] = [];
    const baseFetch = dashboardFetch();
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      if (String(input).endsWith("/alerts?status=NEW")) {
        return Promise.resolve(okJsonResponse(snapshot));
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { useMonitorStore } = await import("./monitorStore");

    useMonitorStore.getState().start(SCOPED_FACILITY_ID);
    await vi.advanceTimersByTimeAsync(0);
    sources[0].onopen?.();
    const sameAlert = alertDtoWith({ id: "alert-sse-poll", alertSeq: "90" });
    sources[0].emit("alert", sameAlert);
    snapshot = [sameAlert];
    sources[0].onerror?.();
    await vi.advanceTimersByTimeAsync(3_150);

    expect(useMonitorStore.getState().dashboard?.unacknowledgedEvents.map((item) => item.id)).toEqual([
      "alert-sse-poll",
    ]);
    useMonitorStore.getState().stop();
  });

  it("keeps reconnect replay single but preserves two distinct same-space alert IDs", async () => {
    const sources = installSyntheticEventSource();
    vi.stubGlobal("fetch", dashboardFetch());
    const { useMonitorStore } = await import("./monitorStore");

    useMonitorStore.getState().start(SCOPED_FACILITY_ID);
    await vi.advanceTimersByTimeAsync(0);
    sources[0].onopen?.();
    const first = alertDtoWith({ id: "alert-reconnect-1", alertSeq: "91" });
    const second = alertDtoWith({ id: "alert-reconnect-2", alertSeq: "92" });
    sources[0].emit("alert", first);
    sources[0].onerror?.();
    sources[0].onopen?.();
    sources[0].emit("alert", first);
    sources[0].emit("alert", second);

    expect(useMonitorStore.getState().dashboard?.unacknowledgedEvents.map((item) => item.id)).toEqual([
      "alert-reconnect-2",
      "alert-reconnect-1",
    ]);
    useMonitorStore.getState().stop();
  });

  it("tears down every timer, listener, and EventSource", async () => {
    const sources = installSyntheticEventSource();
    vi.stubGlobal("fetch", dashboardFetch());
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const { useMonitorStore } = await import("./monitorStore");

    useMonitorStore.getState().start(SCOPED_FACILITY_ID);
    await vi.advanceTimersByTimeAsync(0);
    sources[0].onopen?.();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    useMonitorStore.getState().stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(sources[0].close).toHaveBeenCalledTimes(1);
    expect(sources[0].listenerCount()).toBe(0);
    expect(removeDocumentListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith("online", expect.any(Function));

    vi.useRealTimers();
  });
});

describe("stale-boundary — 3분 경계가 스토어까지 반영된다", () => {
  // 계획의 B1 수용 기준이 이 이름으로 실행된다
  // (`vitest run src/stores/monitorStore.test.ts -t stale-boundary`).
  // 순수 함수 경계는 services/api/cameras.test.ts가 검증하고, 여기서는
  // 그 판정이 실제 스토어 상태까지 도달하는지 본다.
  // 실제 시계를 쓰면 픽스처 생성과 판정 사이에 시간이 흘러 정확히 180초가
  // 181초가 된다. 경계 검증은 시계를 고정해야 의미가 있다.
  const FIXED_NOW = Date.parse("2026-08-04T00:00:00.000Z");

  function cameraSeenMsAgo(ms: number): CameraDto {
    return {
      ...staleCameraDto,
      lastSeenAt: new Date(FIXED_NOW - ms).toISOString(),
    };
  }

  it("정확히 180초 경과는 LIVE로 남는다", async () => {
    vi.setSystemTime(FIXED_NOW);
    vi.stubGlobal("fetch", dashboardFetch([], [activeSpace], [cameraSeenMsAgo(180_000)]));
    vi.stubGlobal("EventSource", undefined);
    const { useMonitorStore } = await import("./monitorStore");
    const expectedLastSeenAt = cameraSeenMsAgo(180_000).lastSeenAt;
    const statusReady = storeSignal(
      useMonitorStore,
      (state) => state.statuses.sp_201?.lastSeenAt === expectedLastSeenAt,
    );

    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 10_000);
    await statusReady;

    expect(useMonitorStore.getState().statuses.sp_201.connection).toBe("LIVE");
    useMonitorStore.getState().stop();
  });

  it("181초 경과는 STALE이 된다", async () => {
    vi.setSystemTime(FIXED_NOW);
    vi.stubGlobal("fetch", dashboardFetch([], [activeSpace], [cameraSeenMsAgo(181_000)]));
    vi.stubGlobal("EventSource", undefined);
    const { useMonitorStore } = await import("./monitorStore");
    const expectedLastSeenAt = cameraSeenMsAgo(181_000).lastSeenAt;
    const statusReady = storeSignal(
      useMonitorStore,
      (state) => state.statuses.sp_201?.lastSeenAt === expectedLastSeenAt,
    );

    useMonitorStore.getState().start(SCOPED_FACILITY_ID, 10_000);
    await statusReady;

    expect(useMonitorStore.getState().statuses.sp_201.connection).toBe("STALE");
    useMonitorStore.getState().stop();
  });
});
