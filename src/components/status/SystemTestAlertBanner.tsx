import { useLayoutEffect, useMemo, useRef } from "react";
import { FlaskConical } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { recordDashboardPresentation } from "@/services/dashboardReceiptService";
import type { DashboardReceiptSurface } from "@/services/dashboardReceiptService";
import { SYSTEM_TEST_LABEL, SYSTEM_TEST_MODE, type DetectionEvent } from "@/types";

export function SystemTestAlertBanner({
  alerts,
  surface = "monitor-system-test-banner:focus",
}: {
  alerts: readonly DetectionEvent[];
  surface?: DashboardReceiptSurface;
}) {
  const systemTests = useMemo(() => {
    const byId = new Map<string, DetectionEvent>();
    for (const alert of alerts) {
      if (alert.testMode !== SYSTEM_TEST_MODE || alert.eventType !== "SYSTEM_TEST") continue;
      if (!byId.has(alert.id)) byId.set(alert.id, alert);
    }
    return [...byId.values()];
  }, [alerts]);

  if (systemTests.length === 0) return null;

  return (
    <section className="space-y-2" aria-label="SYSTEM TEST alerts" data-system-test-alert-list>
      {systemTests.map((alert) => (
        <SystemTestCard key={alert.id} alert={alert} surface={surface} />
      ))}
    </section>
  );
}

function SystemTestCard({
  alert,
  surface,
}: {
  alert: DetectionEvent;
  surface: DashboardReceiptSurface;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const alertSeq = alert.alertSeq;
  const backendEventId = alert.backendEventId;

  useLayoutEffect(() => {
    if (!cardRef.current?.isConnected || !alertSeq || !backendEventId) return;
    void recordDashboardPresentation(
      { id: alert.id, alertSeq, backendEventId },
      surface,
    ).catch(() => undefined);
  }, [alert.id, alertSeq, backendEventId, surface]);

  return (
    <div
      ref={cardRef}
      role="status"
      aria-label={`${SYSTEM_TEST_MODE}: ${SYSTEM_TEST_LABEL}`}
      data-alert-id={alert.id}
      data-backend-event-id={backendEventId ?? undefined}
      data-correlation-id={backendEventId ?? alert.id}
      data-test-mode={SYSTEM_TEST_MODE}
      data-status={SYSTEM_TEST_MODE}
      className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed border-ink-faint bg-surface2 px-4 py-3 text-ink shadow-card"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink-soft" aria-hidden="true">
        <FlaskConical className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-ink px-2 py-1 text-sm font-black tracking-wide text-surface">
            SYSTEM TEST
          </span>
          <span className="text-sm font-black text-ink-soft">{SYSTEM_TEST_LABEL}</span>
        </div>
        <time className="mt-1 block text-sm font-bold text-ink-soft" dateTime={alert.detectedAt}>
          {formatDateTime(alert.detectedAt)}
        </time>
      </div>
    </div>
  );
}
