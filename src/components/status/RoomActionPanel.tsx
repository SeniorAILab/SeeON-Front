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
  const canResolve = alerts.length > 0;
  // 확인 처리 실패 사유. 서버가 거부하면 여기에 뜬다.
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
          "확인 처리를 하지 못했습니다. 다시 시도해 주세요.",
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
            {alerts.length > 0 && <span className="ml-2 text-staff-body font-bold text-ink-soft">{alerts.length}건</span>}
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
                      disabled={busy}
                      onClick={() => void handleResolve([alert.id])}
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

      {/* 확인 한 번이 곧 처리 완료다. isActiveAlert()는 백엔드 상태가
          RESOLVED가 아닌 한 계속 "활성"으로 보므로(alertMerge.ts:226-228),
          resolve() 호출만이 알림을 보드에서 내릴 수 있다. 두 단계로 나뉜
          예전 흐름은 더 이상 없다 — 이 버튼 하나가 전부다. */}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={!canResolve || busy}
          onClick={() => void handleResolve()}
          className="h-14 rounded-2xl bg-brand px-5 text-staff-btn text-white shadow-card disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-ink-faint"
        >
          {busy ? "처리 중" : alerts.length > 1 ? "모두 확인" : "확인"}
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
