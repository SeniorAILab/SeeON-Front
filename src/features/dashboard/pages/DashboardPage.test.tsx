import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";
import { useDashboard } from "@/features/dashboard/hooks/useDashboard";
import type { DashboardResponse } from "@/types";

vi.mock("@/features/dashboard/hooks/useDashboard", () => ({
  useDashboard: vi.fn(),
}));

vi.mock("@/hooks/useActiveFacilityId", () => ({
  useActiveFacilityId: () => "facility-dashboard-test",
}));

vi.mock("@/components/status/RoomStatusBoard", () => ({
  RoomStatusBoard: () => <div data-testid="room-status-board" />,
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

const dashboard: DashboardResponse = {
  facility: { id: "facility-dashboard-test", name: "테스트 요양원", address: "서울", phone: "02-0000-0000" },
  floors: [],
  spaces: [],
  statuses: {},
  summary: { totalSpaces: 0, stable: 0, caution: 0, danger: 0, checkNeeded: 0, unacknowledged: 1 },
  unacknowledgedEvents: [],
};

const dashboardWithActiveSpace: DashboardResponse = {
  facility: { id: "facility-dashboard-test", name: "테스트 요양원", address: "서울", phone: "02-0000-0000" },
  floors: [{ id: "1F", facilityId: "facility-dashboard-test", name: "1층", orderIndex: 0, provisioningSource: "PRODUCT" }],
  spaces: [
    { id: "room-1", facilityId: "facility-dashboard-test", name: "101호", floorId: "1F", type: "ROOM", isActive: true, capacity: 1, provisioningSource: "PRODUCT" },
  ],
  statuses: {
    "room-1": {
      id: "status-1",
      spaceId: "room-1",
      peopleCount: 0,
      movementLevel: "LOW",
      fallRiskLevel: "LOW",
      status: "STABLE",
      connection: "LIVE",
      lastSeenAt: "2024-01-01T00:00:00Z",
      lastDetectedAt: "2024-01-01T00:00:00Z",
      alertStatus: "NONE",
    },
  },
  summary: { totalSpaces: 1, stable: 1, caution: 0, danger: 0, checkNeeded: 0, unacknowledged: 0 },
  unacknowledgedEvents: [],
};

describe("DashboardPage", () => {
  it("navigates the unacknowledged card to the facility OPEN events filter", () => {
    vi.mocked(useDashboard).mockReturnValue({ data: dashboard, loading: false, reload: vi.fn() });

    render(
      <MemoryRouter initialEntries={["/facilities/facility-dashboard-test/admin/dashboard"]}>
        <DashboardPage />
        <LocationProbe />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "미확인 이벤트 1건 보기" }));

    expect(screen.getByTestId("location").textContent).toBe("/facilities/facility-dashboard-test/admin/events?filter=OPEN");
  });

  it("renders RoomStatusBoard without fixed-height cage", () => {
    vi.mocked(useDashboard).mockReturnValue({ data: dashboardWithActiveSpace, loading: false, reload: vi.fn() });

    render(
      <MemoryRouter initialEntries={["/facilities/facility-dashboard-test/admin/dashboard"]}>
        <DashboardPage />
      </MemoryRouter>
    );

    const board = screen.getByTestId("room-status-board");
    const parent = board.parentElement;
    expect(parent?.className).not.toContain("h-[70vh]");
    expect(parent?.className).not.toContain("overflow-hidden");
  });

  it("renders empty state when no spaces", () => {
    vi.mocked(useDashboard).mockReturnValue({ data: dashboard, loading: false, reload: vi.fn() });

    render(
      <MemoryRouter initialEntries={["/facilities/facility-dashboard-test/admin/dashboard"]}>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByText("조건에 맞는 공간이 없습니다.")).toBeDefined();
  });
});
