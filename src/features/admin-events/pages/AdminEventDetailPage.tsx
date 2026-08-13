import { useEffect, useState } from "react";
import { apiErrorMessage } from "@/services/apiClient";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Film } from "lucide-react";
import { Card, Button } from "@/components/ui/primitives";
import { RiskBadge } from "@/components/RiskBadge";
import { AlertStatusBadge } from "@/components/AlertStatusBadge";
import { AIInsightBox } from "@/features/admin-events/components/AIInsightBox";
import { EventTimeline } from "@/features/admin-events/components/EventTimeline";
import { AlertEvidencePanel } from "@/features/admin-events/components/video/AlertEvidencePanel";
import { VideoPermissionGuard } from "@/features/admin-events/components/video/VideoPermissionGuard";
import { VideoAccessNotice } from "@/features/admin-events/components/video/VideoAccessNotice";
import { isEventClipsEnabled } from "@/features/admin-events/eventClipFeature";
import { eventService } from "@/services/eventService";
import { dashboardService } from "@/services/dashboardService";
import { useAuthStore } from "@/stores/authStore";
import { canAcknowledge } from "@/lib/roles";
import { formatDateTime } from "@/lib/format";
import { displayEventTypeLabel, alertLabel } from "@/lib/labels";
import type {
  DetectionEvent,
  Floor,
  Level,
  Space,
  SpaceStatusLevel,
} from "@/types";

const riskToStatus: Record<Level, SpaceStatusLevel> = {
  LOW: "STABLE",
  MEDIUM: "CAUTION",
  HIGH: "DANGER",
};

export function AdminEventDetailPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [event, setEvent] = useState<DetectionEvent | null>(null);
  const [timeline, setTimeline] = useState<DetectionEvent[]>([]);
  const [space, setSpace] = useState<Space | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  // 확인 완료 실패 사유. catch가 없으면 실패해도 화면이 조용해서
  // 관리자가 처리됐다고 믿는다.
  const [actionError, setActionError] = useState<string | null>(null);

  async function loadEvent() {
    if (!eventId) return;
    const ev = await eventService.getById(eventId);
    setEvent(ev ?? null);
    if (ev) {
      const dashboard = await dashboardService.getDashboard(ev.facilityId);
      const matchedSpace = dashboard.spaces.find((s) => s.id === ev.spaceId) ?? null;
      setSpace(matchedSpace);
      setFloor(dashboard.floors.find((f) => f.id === matchedSpace?.floorId) ?? null);
      setTimeline(
        dashboard.unacknowledgedEvents
          .filter((item) => item.spaceId === ev.spaceId)
          .sort((a, b) => +new Date(b.detectedAt) - +new Date(a.detectedAt)),
      );
    } else {
      setSpace(null);
      setFloor(null);
      setTimeline([]);
    }
  }

  useEffect(() => {
    loadEvent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (!event) {
    return <p className="py-16 text-center text-sm text-ink-soft">불러오는 중...</p>;
  }

  const spaceName = space?.name ?? event.room ?? event.spaceId;
  const floorName = floor?.name ?? "층 정보 없음";
  const acked = event.alertStatus === "ACKNOWLEDGED";
  const eventClipsEnabled = isEventClipsEnabled();

  async function handleAcknowledge() {
    if (!user || !event) return;
    setActionError(null);
    setAcknowledging(true);
    try {
      await eventService.acknowledge(event.id, user.name);
      await loadEvent();
    } catch (caught) {
      // 서버가 거부해도 조용히 넘어가면 관리자는 처리됐다고 믿는다.
      setActionError(
        apiErrorMessage(caught, "조치를 저장하지 못했습니다. 다시 시도해 주세요."),
      );
    } finally {
      setAcknowledging(false);
    }
  }



  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        이벤트 목록
      </button>

      {/* 상단 요약 */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">
              {spaceName} 이슈 상세
            </h1>
            <p className="mt-0.5 text-sm text-ink-faint">
              {floorName} · {displayEventTypeLabel(event)} · {formatDateTime(event.detectedAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RiskBadge level={event.riskLevel} />
            <span
              className={
                "rounded-md px-2 py-1 text-xs font-semibold " +
                (acked
                  ? "bg-status-stableBg text-status-stable"
                  : "bg-status-cautionBg text-status-caution")
              }
            >
              {acked ? "확인 완료" : "확인 대기"}
            </span>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-3 text-sm font-medium text-ink">
            AI 안전 분석: 위험 이벤트가 감지되었습니다
          </p>
          <AIInsightBox
            summary={event.aiSummary}
            status={riskToStatus[event.riskLevel]}
          />
        </div>
      </Card>

      {eventClipsEnabled && user !== null ? (
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
            <Film aria-hidden="true" className="h-[18px] w-[18px]" />
            감지 근거 영상
          </h2>
          <p className="mb-3 text-sm leading-relaxed text-ink-soft break-keep">
            관리자 권한으로 이 알림에 연결된 안전 확인용 클립만 확인할 수 있습니다.
            보관 상태를 확인할 수 없으면 해당 상태를 그대로 표시합니다.
          </p>
          <VideoPermissionGuard>
            <div className="space-y-3">
              <VideoAccessNotice />
              <AlertEvidencePanel
                identity={{ facilityId: event.facilityId, alertId: event.id, userId: user.id }}
              />
            </div>
          </VideoPermissionGuard>
        </Card>
      ) : null}

      {/* 이벤트 타임라인 */}
      <Card className="p-5">
        <h2 className="mb-3 text-base font-semibold text-ink">이벤트 타임라인</h2>
        <EventTimeline events={timeline.slice(0, 10)} />
      </Card>

      {/* 확인 완료 처리 */}
      <Card className="p-5">
        <h2 className="mb-3 text-base font-semibold text-ink">확인 완료 처리</h2>
        <Button
          onClick={handleAcknowledge}
          disabled={!canAcknowledge(user) || acked || acknowledging}
        >
          {acknowledging ? "처리 중..." : "확인 완료"}
        </Button>
        {actionError && (
          <p role="alert" className="mt-3 rounded-lg bg-status-dangerBg px-3 py-2 text-sm font-semibold text-status-danger">
            {actionError}
          </p>
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold text-ink">알림 상태</h2>
          <AlertStatusBadge status={event.alertStatus} />
          <span className="text-xs text-ink-faint">{alertLabel[event.alertStatus]}</span>
        </div>
        <p className="text-sm text-ink-faint">알림 처리 내역은 위의 타임라인에서 확인할 수 있습니다.</p>
      </Card>
    </div>
  );
}
