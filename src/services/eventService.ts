import { acknowledgeAlert, getAlertById, listAllAlerts } from "@/services/api/alertEndpoints";
import { ApiError } from "@/services/apiClient";
import type { DetectionEvent } from "@/types";

let alertCache: DetectionEvent[] = [];


export const eventService = {
  async getById(eventId: string, signal?: AbortSignal): Promise<DetectionEvent | undefined> {
    // 목록 캐시에서 찾지 않고 단건 라우트로 직접 간다. 목록을 거치면
    // 상세 열람이 "목록을 어디까지 받아왔는가"에 매인다. 링크로 바로
    // 들어오는 경우처럼 목록을 아직 안 받은 상태에서도 열려야 한다.
    try {
      return await getAlertById(eventId, signal);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return undefined;
      throw error;
    }
  },

  /** 공간의 현재 미확인 이벤트(최신) — 침대/사유 표시용 */
  openForSpace(spaceId: string): DetectionEvent | undefined {
    const events = alertCache;
    return events
      .filter((e) => e.spaceId === spaceId && e.alertStatus !== "ACKNOWLEDGED" && e.riskLevel !== "LOW")
      .sort((a, b) => +new Date(b.detectedAt) - +new Date(a.detectedAt))[0];
  },

  async listByFacility(facilityId: string): Promise<DetectionEvent[]> {
    // 목록 화면은 과거 사건을 찾는 곳이므로 전부 모은다. 서버 기본값(50건)만
    // 받으면 그보다 오래된 사건이 화면에서 사라진 것처럼 보인다.
    const events = await listAllAlerts();
    alertCache = events;
    return events
      .filter((e) => e.facilityId === facilityId)
      .sort((a, b) => +new Date(b.detectedAt) - +new Date(a.detectedAt));
  },
  async acknowledge(eventId: string, userName: string): Promise<DetectionEvent> {
    const ev = await acknowledgeAlert(eventId);
    alertCache = alertCache.map((item) => (item.id === ev.id ? ev : item));
    return { ...ev, acknowledgedBy: userName, acknowledgedAt: ev.acknowledgedAt ?? new Date().toISOString() };
  },


};
