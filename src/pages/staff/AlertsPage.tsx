import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCheck } from "lucide-react";
import { StaffStatusBadge } from "@/components/staff/StaffStatusBadge";
import { formatDateTime } from "@/lib/format";
import { eventPresentationFor } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { alertService } from "@/services/alertService";
import type { AlertStatus, AlertView, SpaceStatusLevel } from "@/types";

const statusBadge: Record<AlertStatus, SpaceStatusLevel> = {
  NEW: "CHECK_NEEDED",
  ACKED: "CAUTION",
  RESOLVED: "STABLE",
};

export function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 방금 도착한 고위험 알림에만 pulse를 준다. 첫 로드는 화면을 처음 여는
  // 순간이라 "새로 도착"이 아니므로 조용히 seed만 하고 pulse를 걸지 않는다.
  const seenIdsRef = useRef<Set<string> | null>(null);
  const [pulsingIds, setPulsingIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextAlerts = await alertService.listRecent(200);
      const previouslySeen = seenIdsRef.current;
      if (previouslySeen) {
        const newlyArrived = new Set<string>();
        for (const alert of nextAlerts) {
          if (
            alert.status === "NEW" &&
            eventPresentationFor(alert.type).severity === "high" &&
            !previouslySeen.has(alert.id)
          ) {
            newlyArrived.add(alert.id);
          }
        }
        if (newlyArrived.size > 0) {
          setPulsingIds((prev) => new Set([...prev, ...newlyArrived]));
        }
      }
      seenIdsRef.current = new Set(nextAlerts.map((alert) => alert.id));
      setAlerts(nextAlerts);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(
    () => ({
      OUTSTANDING: alerts.filter((alert) => alert.status === "NEW" || alert.status === "ACKED"),
      RESOLVED: alerts.filter((alert) => alert.status === "RESOLVED"),
    }),
    [alerts]
  );

  /** 확인 한 번이 곧 처리 완료다. isActiveAlert()는 RESOLVED가 아닌 한 계속
   *  "활성"으로 보므로(alertMerge.ts:226-228), resolve() 호출만이 알림을
   *  보드에서 내릴 수 있다. 두 단계로 나뉜 예전 흐름은 더 이상 없다. */
  async function resolve(alert: AlertView) {
    await runAction(alert.id, () => alertService.resolve(alert.id));
  }

  async function runAction(id: string, action: () => Promise<AlertView>) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-staff-name text-ink">알림 처리</h1>

      {error && (
        <p className="rounded-xl bg-status-dangerBg p-4 text-staff-body text-status-danger">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-16 text-center text-staff-body text-ink-soft">불러오는 중입니다...</p>
      ) : (
        <div className="space-y-6">
          <AlertSection
            title="확인 필요"
            empty="확인할 새 알림이 없습니다."
            alerts={grouped.OUTSTANDING}
            renderMeta={(alert) => alertMeta(alert, formatDateTime(alert.detectedAt))}
            pulseClassFor={(alert) => (pulsingIds.has(alert.id) ? "animate-pulse-alert-new motion-reduce:animate-none" : "")}
            renderAction={(alert) => (
              <button
                disabled={busyId !== null}
                onClick={() => resolve(alert)}
                className="min-h-[56px] rounded-xl bg-brand px-6 text-staff-btn text-white disabled:opacity-60"
              >
                {alert.testMode === "SYSTEM_TEST" ? "테스트 확인" : "확인"}
              </button>
            )}
          />

          <AlertSection
            title="처리됨"
            empty="처리된 알림이 없습니다."
            alerts={grouped.RESOLVED}
            renderMeta={(alert) =>
              alertMeta(alert, `${alert.resolvedByName ?? "직원"} 해결 · ${formatDateTime(
                alert.resolvedAt ?? alert.detectedAt
              )}`)
            }
          />
        </div>
      )}
    </div>
  );
}

function AlertSection({
  title,
  empty,
  alerts,
  renderMeta,
  renderAction,
  pulseClassFor,
}: {
  title: string;
  empty: string;
  alerts: AlertView[];
  renderMeta: (alert: AlertView) => string;
  /** 카드마다 정확히 하나만 보이는 주요 동작. */
  renderAction?: (alert: AlertView) => ReactNode;
  /** 방금 도착한 고위험 카드에만 적용할 유한 pulse 클래스. */
  pulseClassFor?: (alert: AlertView) => string;
}) {
  return (
    <section className="space-y-3" aria-labelledby={`${title}-heading`}>
      <h2 id={`${title}-heading`} className="text-staff-status text-ink">
        {title}
      </h2>
      {alerts.length === 0 ? (
        <div className="rounded-2xl border-2 border-border bg-surface px-6 py-10 text-center">
          <CheckCheck className="mx-auto mb-3 h-12 w-12 text-ink-faint" />
          <p className="text-staff-body text-ink-soft">{empty}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const presentation = eventPresentationFor(alert.type);
            const Icon = presentation.icon;
            return (
              <div
                key={alert.id}
                data-alert-id={alert.id}
                data-backend-event-id={alert.backendEventId ?? undefined}
                data-correlation-id={alert.backendEventId ?? alert.id}
                data-test-mode={alert.testMode}
                data-status={alert.testMode === "SYSTEM_TEST" ? "SYSTEM_TEST" : alert.status}
                className={cn(
                  "flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface p-5 shadow-card",
                  pulseClassFor?.(alert)
                )}
              >
                <div
                  className={cn(
                    "flex h-14 w-14 shrink-0 items-center justify-center rounded-full",
                    presentation.severity === "high"
                      ? "bg-status-dangerBg text-status-danger"
                      : "bg-surface2 text-ink-soft"
                  )}
                  aria-hidden="true"
                >
                  <Icon className="h-8 w-8" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-staff-status text-ink">{presentation.title}</span>
                    <StaffStatusBadge status={statusBadge[alert.status]} />
                  </div>
                  <p className="mt-1 text-staff-body text-ink-soft">{renderMeta(alert)}</p>
                </div>
                {renderAction?.(alert)}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function alertMeta(alert: AlertView, prefix: string): string {
  return alert.testMode === "SYSTEM_TEST" ? prefix : `${prefix} · ${alert.room ?? "공간"}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "알림을 처리하지 못했습니다.";
}
