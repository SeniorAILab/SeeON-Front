import { useEffect, useRef, useState } from "react";
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
  const loadGeneration = useRef(0);
  const loadController = useRef<AbortController | null>(null);

  const [event, setEvent] = useState<DetectionEvent | null>(null);
  const [timeline, setTimeline] = useState<DetectionEvent[]>([]);
  const [space, setSpace] = useState<Space | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  // 확인 완료 실패 사유. catch가 없으면 실패해도 화면이 조용해서
  // 관리자가 처리됐다고 믿는다.
  const [actionError, setActionError] = useState<string | null>(null);

  async function loadEvent() {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError(null);
    setActionError(null);
    setAcknowledging(false);
    try {
      if (!eventId) {
        if (generation === loadGeneration.current) setEvent(null);
        return;
      }
      const ev = await eventService.getById(eventId, controller.signal);
      if (!ev) {
        if (generation !== loadGeneration.current) return;
        setEvent(null);
        setSpace(null);
        setFloor(null);
        setTimeline([]);
        return;
      }
      const dashboard = await dashboardService.getDashboard(ev.facilityId, controller.signal);
      if (generation !== loadGeneration.current) return;
      const matchedSpace = dashboard.spaces.find((s) => s.id === ev.spaceId) ?? null;
      setEvent(ev);
      setSpace(matchedSpace);
      setFloor(dashboard.floors.find((f) => f.id === matchedSpace?.floorId) ?? null);
      setTimeline(
        dashboard.unacknowledgedEvents
          .filter((item) => item.spaceId === ev.spaceId)
          .sort((a, b) => +new Date(b.detectedAt) - +new Date(a.detectedAt)),
      );
    } catch (caught) {
      if (generation !== loadGeneration.current) return;
      setEvent(null);
      setSpace(null);
      setFloor(null);
      setTimeline([]);
      setLoadError(
        apiErrorMessage(caught, "이벤트를 불러오지 못했습니다. 다시 시도해 주세요."),
      );
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadEvent();
    return () => {
      loadController.current?.abort();
      loadGeneration.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (loading) {
    return <p className="py-16 text-center text-sm text-ink-soft">불러오는 중...</p>;
  }

  if (loadError) {
    return (
      <div className="space-y-3 py-16 text-center">
        <p role="alert" className="text-sm font-semibold text-status-danger">{loadError}</p>
        <Button onClick={() => void loadEvent()}>다시 시도</Button>
      </div>
    );
  }

  if (!event) {
    return <p className="py-16 text-center text-sm text-ink-soft">이벤트를 찾을 수 없습니다.</p>;
  }

  const spaceName = space?.name ?? event.room ?? event.spaceId;
  const floorName = floor?.name ?? "층 정보 없음";
  const acked = event.alertStatus === "ACKNOWLEDGED";
  async function handleAcknowledge() {
    if (!user || !event) return;
    const generation = loadGeneration.current;
    setActionError(null);
    setAcknowledging(true);
    try {
      await eventService.acknowledge(event.id, user.name);
      if (generation !== loadGeneration.current) return;
      setAcknowledging(false);
      await loadEvent();
    } catch (caught) {
      if (generation !== loadGeneration.current) return;
      // 서버가 거부해도 조용히 넘어가면 관리자는 처리됐다고 믿는다.
      setActionError(
        apiErrorMessage(caught, "조치를 저장하지 못했습니다. 다시 시도해 주세요."),
      );
    } finally {
      if (generation === loadGeneration.current) setAcknowledging(false);
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

      {user !== null ? (
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
