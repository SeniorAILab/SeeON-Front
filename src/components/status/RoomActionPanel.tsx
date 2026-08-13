import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { X } from "lucide-react";
import { alertService } from "@/services/alertService";
import { apiErrorMessage } from "@/services/apiClient";
import type { DetectionEvent, Space, SpaceStatus } from "@/types";
import { detectionEventPresentationFor, displayEventTypeLabel } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";

const statusWord = { STABLE: "안정", CAUTION: "주의", DANGER: "위험", CHECK_NEEDED: "확인 필요" } as const;
const INITIAL_ALERTS = 5;
const ALERTS_PER_PAGE = 20;

export function RoomActionPanel({
  space,
  status,
  alerts = [],
  onClose,
  onResolved,
}: {
  space: Space;
  status?: SpaceStatus;
  alerts?: DetectionEvent[];
  onClose: () => void;
  onResolved?: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const hasCapturedTriggerRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [busy, setBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_ALERTS);
  const feed = useMemo(
    () => [...alerts].sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt)),
    [alerts],
  );
  const unacknowledgedCount = alerts.filter((alert) => alert.alertStatus !== "ACKNOWLEDGED").length;
  const canResolve = alerts.length > 0;
  // 아직 아무도 확인하지 않은 알림이 있을 때만 "확인"이 의미가 있다.
  const canAcknowledge = unacknowledgedCount > 0;
  // 해결 완료 실패 사유. 서버가 거부하면 여기에 뜬다.
  const [resolveError, setResolveError] = useState<string | null>(null);

  const closePanel = useCallback(() => {
    triggerRef.current?.focus();
    onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!hasCapturedTriggerRef.current) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      hasCapturedTriggerRef.current = true;
    }
    dialogRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closePanel();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closePanel]);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * 확인(ACK). 알림을 받았다는 신호만 보낸다 — 조치 기록을 요구하지 않는다.
   * TV 앞에서 타이핑하기 전에 "내가 간다"를 먼저 알려야 다른 요양보호사가
   * 같은 방으로 중복 출동하지 않는다.
   */
  async function handleAcknowledge() {
    await handleAcknowledgeIds(
      alerts
        .filter((alert) => alert.alertStatus !== "ACKNOWLEDGED")
        .map((alert) => alert.id),
    );
  }

  async function handleAcknowledgeIds(ids: string[]) {
    if (ids.length === 0 || busy) return;
    setBusy(true);
    setResolveError(null);
    try {
      await Promise.all(ids.map((id) => alertService.acknowledge(id)));
      onResolved?.();
    } catch (caught) {
      setResolveError(
        apiErrorMessage(caught, "확인 처리를 하지 못했습니다. 다시 시도해 주세요."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleResolve(alertIds?: string[]) {
    const ids = alertIds ?? alerts.map((alert) => alert.id);
    if (ids.length === 0 || busy) return;
    setBusy(true);
    setResolveError(null);
    try {
      await Promise.all(ids.map((id) => alertService.resolve(id)));
      onResolved?.();
    } catch (caught) {
      // catch가 없으면 서버가 거부해도 화면에서 아무 일도 일어나지 않는다.
      // 요양보호사는 처리했다고 믿고 자리를 뜬다 — 침묵으로 장애를 표현하는
      // 것과 같다. 어떤 이유로든 해결 요청이 실패하면 반드시 화면에 사유를 보여준다.
      setResolveError(
        apiErrorMessage(
          caught,
          "해결 완료로 바꾸지 못했습니다. 다시 시도해 주세요.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  const visibleFeed = feed.slice(0, visibleCount);
  const hiddenCount = feed.length - visibleFeed.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onMouseDown={closePanel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={space.name}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-border bg-surface p-4 shadow-modal"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="break-keep text-2xl font-black leading-tight text-ink 2xl:text-3xl">{space.name}</div>
          <div className="mt-1 text-lg font-bold text-ink-soft">
            {statusWord[status?.status ?? "STABLE"]}
            {alerts.length > 0 && <span className="ml-2 text-staff-body font-bold text-ink-soft">미확인 {unacknowledgedCount}건</span>}
          </div>
        </div>
        <button type="button" onClick={closePanel} className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border text-ink-soft hover:bg-surface2" aria-label="모달 닫기">
          <X className="h-7 w-7" />
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-bg px-4 py-3">
        {feed.length === 0 ? (
          <div className="rounded-2xl bg-surface2 px-4 py-3 text-staff-body font-bold text-ink-soft">현재 조치가 필요한 이벤트가 없습니다.</div>
        ) : (
          <>
            <ul className="space-y-2">
              {visibleFeed.map((alert) => {
                const presentation = detectionEventPresentationFor(alert.eventType);
                const title = alert.eventType === "OTHER" ? displayEventTypeLabel(alert) : presentation.title;
                const isAcknowledged = alert.alertStatus === "ACKNOWLEDGED";
                const Icon = presentation.icon;
                const isDanger = presentation.severity === "high";
                return (
                  <li
                    key={alert.id}
                    data-event-type={alert.eventType}
                    className="flex items-center gap-3 rounded-xl bg-surface2 px-3 py-2"
                  >
                    <div
                      aria-hidden="true"
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                        isDanger ? "bg-status-dangerBg text-status-danger" : "bg-status-cautionBg text-status-caution"
                      }`}
                    >
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-staff-body font-black text-ink">{title}</div>
                      <div className="mt-1 text-sm font-bold text-ink-faint">{formatDateTime(alert.detectedAt)}</div>
                    </div>
                    <button
                      type="button"
                      disabled={busy || isAcknowledged}
                      onClick={() => void handleAcknowledgeIds([alert.id])}
                      className="min-h-12 shrink-0 rounded-lg border border-border px-3 py-1 text-staff-btn text-ink disabled:cursor-not-allowed disabled:text-ink-faint"
                    >
                      확인
                    </button>
                  </li>
                );
              })}
            </ul>
            {(hiddenCount > 0 || visibleFeed.length > INITIAL_ALERTS) && (
              <div className="mt-2 flex gap-2">
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((count) => count + ALERTS_PER_PAGE)}
                    className="min-h-12 rounded-lg border border-border px-3 py-1 text-staff-btn text-ink hover:bg-surface2"
                  >
                    더 보기 ({hiddenCount})
                  </button>
                )}
                {visibleFeed.length > INITIAL_ALERTS && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount(INITIAL_ALERTS)}
                    className="min-h-12 rounded-lg border border-border px-3 py-1 text-staff-btn text-ink hover:bg-surface2"
                  >
                    접기
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-4 text-staff-body font-bold text-ink-soft">
        먼저 <b>확인</b>을 눌러 알림을 받았다고 알리세요. 현장을 확인한 뒤
        <b>해결 완료</b>를 누르면 알람이 꺼집니다. 텍스트를 입력할 필요는 없습니다.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {/* 확인(ACK)과 해결 완료(RESOLVE)는 조치 기록을 요구하지 않는다 —
            화면에는 텍스트 입력이 없다. TV 앞에서 타이핑하기 전에 "내가
            간다"를 먼저 알려야 다른 사람이 중복으로 달려가지 않는다. */}
        <button
          type="button"
          disabled={!canAcknowledge || busy}
          onClick={() => void handleAcknowledge()}
          className="h-14 rounded-2xl border border-brand px-5 text-staff-btn text-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:border-border disabled:text-ink-faint"
        >
          {busy ? "처리 중" : "확인"}
        </button>
        <button type="button" disabled={!canResolve || busy} onClick={() => void handleResolve()} className="h-14 rounded-2xl bg-brand px-5 text-staff-btn text-white shadow-card disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-ink-faint">
          {busy ? "처리 중" : "해결 완료"}
        </button>
      </div>
      {resolveError && (
        <div role="alert" className="mt-2 rounded-2xl bg-status-dangerBg px-4 py-3 text-staff-body font-bold text-status-danger">
          {resolveError}
        </div>
      )}
      </div>
    </div>
  );
}
