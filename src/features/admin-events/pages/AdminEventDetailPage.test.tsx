import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { alertService } from "@/services/alertService";
import { dashboardService } from "@/services/dashboardService";
import { eventService } from "@/services/eventService";
import { useAuthStore } from "@/stores/authStore";
import type { DashboardResponse, DetectionEvent, User } from "@/types";
import { AdminEventDetailPage } from "./AdminEventDetailPage";

vi.mock("@/services/alertService", () => ({
  alertService: {
    getMedia: vi.fn(),
    recordMediaAccess: vi.fn(),
  },
}));

vi.mock("@/services/dashboardService", () => ({
  dashboardService: { getDashboard: vi.fn() },
}));

vi.mock("@/services/eventService", () => ({
  eventService: {
    acknowledge: vi.fn(),
    getById: vi.fn(),
  },
}));

const USER: User = {
  id: "user-1",
  name: "관리자",
  email: "admin@example.test",
  role: "ADMIN",
  facilityId: "facility-1",
};

const EVENT: DetectionEvent = {
  id: "alert-1",
  facilityId: "facility-1",
  spaceId: "space-1",
  room: "101호",
  eventType: "FALL_RISK",
  riskLevel: "HIGH",
  message: "낙상 감지",
  aiSummary: "위험 이벤트가 감지되었습니다.",
  detectedAt: "2026-07-16T00:00:10.000Z",
  alertStatus: "PENDING",
};

const DASHBOARD: DashboardResponse = {
  facility: {
    id: "facility-1",
    name: "행복한 요양원",
    address: "",
    phone: "",
  },
  floors: [{ id: "floor-1", facilityId: "facility-1", name: "1층", orderIndex: 1, provisioningSource: "PRODUCT" }],
  spaces: [{
    id: "space-1",
    facilityId: "facility-1",
    floorId: "floor-1",
    name: "101호",
    type: "ROOM",
    capacity: 1,
    isActive: true,
    provisioningSource: "PRODUCT",
  }],
  statuses: {},
  summary: {
    totalSpaces: 1,
    stable: 0,
    caution: 0,
    danger: 1,
    checkNeeded: 0,
    unacknowledged: 1,
  },
  unacknowledgedEvents: [],
};

function renderDetail(): void {
  render(
    <MemoryRouter initialEntries={["/events/alert-1"]}>
      <Routes>
        <Route path="/events/:eventId" element={<AdminEventDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(eventService.getById).mockResolvedValue(EVENT);
  vi.mocked(dashboardService.getDashboard).mockResolvedValue(DASHBOARD);
  vi.mocked(alertService.getMedia).mockResolvedValue({
    status: "UNAVAILABLE",
    alertId: EVENT.id,
  });
  vi.mocked(alertService.recordMediaAccess).mockResolvedValue();
  useAuthStore.setState({ user: USER, initialized: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  useAuthStore.setState({ user: null, initialized: false });
});

describe("AdminEventDetailPage alert evidence integration", () => {
  it("keeps the evidence card and metadata request off by default", async () => {
    vi.stubEnv("VITE_EVENT_CLIPS_ENABLED", undefined);
    renderDetail();

    expect(await screen.findByRole("heading", { name: "101호 이슈 상세" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "감지 근거 영상" })).toBeNull();
    expect(alertService.getMedia).not.toHaveBeenCalled();
  });

  it("loads alert-bound evidence only when the deployment opts in", async () => {
    vi.stubEnv("VITE_EVENT_CLIPS_ENABLED", "true");
    renderDetail();

    expect(await screen.findByRole("heading", { name: "감지 근거 영상" })).toBeTruthy();
    expect(await screen.findByText("이 알림에 연결된 근거 영상이 없습니다.")).toBeTruthy();
    const description = screen.getByText(
      /관리자 권한으로 이 알림에 연결된 안전 확인용 클립만 확인할 수 있습니다/,
    );

    expect(description.classList.contains("text-ink-soft")).toBe(true);
    expect(description.classList.contains("text-ink-faint")).toBe(false);
    expect(alertService.getMedia).toHaveBeenCalledWith(EVENT.id, expect.any(AbortSignal));
  });
});

describe("확인 완료 버튼", () => {
  it("클릭하면 노트 없이 acknowledge 서비스를 호출한다", async () => {
    vi.mocked(eventService.acknowledge).mockResolvedValueOnce({
      ...EVENT,
      alertStatus: "ACKNOWLEDGED",
    });

    renderDetail();

    const ackBtn = await screen.findByRole("button", { name: "확인 완료" });
    fireEvent.click(ackBtn);

    await waitFor(() =>
      expect(eventService.acknowledge).toHaveBeenCalledWith(EVENT.id, USER.name),
    );
    expect(vi.mocked(eventService.acknowledge).mock.calls[0]).toHaveLength(2);
  });

  it("미인증(user 없음) 상태에서는 버튼이 비활성화된다", async () => {
    useAuthStore.setState({ user: null, initialized: true });

    renderDetail();

    const ackBtn = await screen.findByRole("button", { name: "확인 완료" });
    expect((ackBtn as HTMLButtonElement).disabled).toBe(true);
    expect(eventService.acknowledge).not.toHaveBeenCalled();
  });

  it("acknowledge가 거부되면 오류 문구를 화면에 띄운다", async () => {
    const { ApiError } = await import("@/services/apiClient");
    vi.mocked(eventService.acknowledge).mockRejectedValueOnce(
      new ApiError(
        400,
        JSON.stringify({
          statusCode: 400,
          message: "확인 완료로 바꿀 수 없습니다.",
        }),
      ),
    );

    renderDetail();

    const ackBtn = await screen.findByRole("button", { name: "확인 완료" });
    fireEvent.click(ackBtn);

    const node = await screen.findByRole("alert");
    expect(node.textContent).toContain("확인 완료로 바꿀 수 없습니다");
  });

  it("네트워크 오류도 문구로 알린다", async () => {
    vi.mocked(eventService.acknowledge).mockRejectedValueOnce(new Error("network down"));

    renderDetail();

    const ackBtn = await screen.findByRole("button", { name: "확인 완료" });
    fireEvent.click(ackBtn);

    const node = await screen.findByRole("alert");
    expect(node.textContent).toContain("조치를 저장하지 못했습니다");
  });

  it("성공하면 오류 문구가 남지 않는다", async () => {
    vi.mocked(eventService.acknowledge).mockResolvedValueOnce({
      ...EVENT,
      alertStatus: "ACKNOWLEDGED",
    });

    renderDetail();

    const ackBtn = await screen.findByRole("button", { name: "확인 완료" });
    fireEvent.click(ackBtn);

    await waitFor(() => expect(eventService.acknowledge).toHaveBeenCalled());
    expect(screen.queryByText(/저장하지 못했습니다/)).toBeNull();
  });
});
