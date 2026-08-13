import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FloorSelectLandingPage } from "./FloorSelectLandingPage";
import { dashboardPath, floorPath } from "@/lib/routeAccess";
import { dashboardService } from "@/services/dashboardService";
import { useAuthStore } from "@/stores/authStore";
import { useFacilityStore } from "@/stores/facilityStore";
import { useMonitorSettingsStore } from "@/features/monitor/stores/monitorSettingsStore";
import type { DashboardResponse, SpaceStatus } from "@/types";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/services/dashboardService", () => ({
  dashboardService: {
    getDashboard: vi.fn(),
  },
}));

const facilityId = "fac_happy_nokyang";
const dangerFloorId = "fl_1f";
const stableFloorId = "fl_2f";

const status = (spaceId: string, level: SpaceStatus["status"]): SpaceStatus => ({
  id: `status_${spaceId}`,
  spaceId,
  peopleCount: level === "STABLE" ? 1 : 0,
  movementLevel: level === "STABLE" ? "LOW" : "HIGH",
  fallRiskLevel: level === "STABLE" ? "LOW" : "HIGH",
  status: level,
  aiSummary: level === "STABLE" ? "안정 상태입니다." : "즉시 확인이 필요합니다.",
  lastDetectedAt: "2026-07-04T00:00:00.000Z",
  connection: "LIVE",
  lastSeenAt: "2026-08-03T11:59:30.000Z",
  alertStatus: level === "STABLE" ? "ACKNOWLEDGED" : "PENDING",
});

const dashboard: DashboardResponse = {
  facility: {
    id: facilityId,
    name: "행복요양원 녹양점",
    address: "의정부시 녹양동",
    phone: "031-000-0000",
  },
  floors: [
    { id: dangerFloorId, facilityId, name: "1층", orderIndex: 1, provisioningSource: "PRODUCT" },
    { id: stableFloorId, facilityId, name: "2층", orderIndex: 2, provisioningSource: "PRODUCT" },
  ],
  spaces: [
    { id: "space_101", facilityId, floorId: dangerFloorId, name: "101호", type: "ROOM", capacity: 2, isActive: true, provisioningSource: "PRODUCT" },
    { id: "space_102", facilityId, floorId: dangerFloorId, name: "102호", type: "ROOM", capacity: 2, isActive: true, provisioningSource: "PRODUCT" },
    { id: "space_201", facilityId, floorId: stableFloorId, name: "201호", type: "ROOM", capacity: 2, isActive: true, provisioningSource: "PRODUCT" },
  ],
  statuses: {
    space_101: status("space_101", "DANGER"),
    space_102: status("space_102", "STABLE"),
    space_201: status("space_201", "STABLE"),
  },
  summary: {
    totalSpaces: 3,
    stable: 2,
    caution: 0,
    danger: 1,
    checkNeeded: 0,
    unacknowledged: 1,
  },
  unacknowledgedEvents: [],
};

describe("FloorSelectLandingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFacilityStore.setState({ currentFacilityId: null });
    useAuthStore.setState({
      user: {
        id: "staff-1",
        name: "Care Staff",
        email: "staff@example.test",
        role: "STAFF",
        facilityId,
      },
      loading: false,
      error: null,
      initialized: true,
    });
    vi.mocked(dashboardService.getDashboard).mockResolvedValue(dashboard);
    useMonitorSettingsStore.setState({ allowAllView: true });
  });

  it("renders floor cards with danger counts and routes floor and all-view clicks", async () => {
    render(<FloorSelectLandingPage />);

    const floorList = await screen.findByRole("list", { name: "층 선택 목록" });
    const cards = within(floorList).getAllByRole("listitem");
    expect(cards).toHaveLength(3);

    const dangerFloorCard = screen.getByRole("button", { name: "1층 이동, 위험 1건" });
    const stableFloorCard = screen.getByRole("button", { name: "2층 이동, 위험 0건" });
    const allViewCard = screen.getByRole("button", { name: "전체 보기 이동, 위험 1건" });

    expect(within(dangerFloorCard).getByText("위험 1건")).toBeTruthy();
    expect(within(stableFloorCard).getByText("위험 0건")).toBeTruthy();
    expect(allViewCard).toBeTruthy();
    expect(dashboardService.getDashboard).toHaveBeenCalledWith(facilityId);

    fireEvent.click(dangerFloorCard);
    expect(mockNavigate).toHaveBeenCalledWith(floorPath(facilityId, dangerFloorId));

    fireEvent.click(allViewCard);
    expect(mockNavigate).toHaveBeenLastCalledWith(dashboardPath(facilityId));
  });
  it("hides the all-floor option when all-floor viewing is disabled", async () => {
    useMonitorSettingsStore.setState({ allowAllView: false });
    render(<FloorSelectLandingPage />);

    await screen.findByRole("list", { name: "층 선택 목록" });
    expect(screen.queryByRole("button", { name: "전체 보기 이동, 위험 1건" })).toBeNull();
  });

  it("(4d) sorts the danger-bearing floor's card first in the floor list, even when its floor number is higher", async () => {
    const dangerHighFloorId = "fl_3f";
    vi.mocked(dashboardService.getDashboard).mockResolvedValue({
      ...dashboard,
      floors: [
        ...dashboard.floors,
        { id: dangerHighFloorId, facilityId, name: "3층", orderIndex: 3, provisioningSource: "PRODUCT" },
      ],
      spaces: [
        { id: "space_101", facilityId, floorId: dangerFloorId, name: "101호", type: "ROOM", capacity: 2, isActive: true, provisioningSource: "PRODUCT" },
        { id: "space_201", facilityId, floorId: stableFloorId, name: "201호", type: "ROOM", capacity: 2, isActive: true, provisioningSource: "PRODUCT" },
        { id: "space_301", facilityId, floorId: dangerHighFloorId, name: "301호", type: "ROOM", capacity: 2, isActive: true, provisioningSource: "PRODUCT" },
      ],
      statuses: {
        space_101: status("space_101", "STABLE"),
        space_201: status("space_201", "STABLE"),
        space_301: status("space_301", "DANGER"),
      },
    });

    render(<FloorSelectLandingPage />);

    const floorList = await screen.findByRole("list", { name: "층 선택 목록" });
    const cards = within(floorList).getAllByRole("listitem");
    expect(within(cards[0]).getByRole("button", { name: "3층 이동, 위험 1건" })).toBeTruthy();
  });

  it("does not offer floors that contain only inactive spaces", async () => {
    const inactiveFloorId = "fl_hidden";
    vi.mocked(dashboardService.getDashboard).mockResolvedValue({
      ...dashboard,
      floors: [
        ...dashboard.floors,
        { id: inactiveFloorId, facilityId, name: "숨김층", orderIndex: 3, provisioningSource: "PRODUCT" },
      ],
      spaces: [
        ...dashboard.spaces,
        {
          id: "space_hidden",
          facilityId,
          floorId: inactiveFloorId,
          name: "숨김 생활실",
          type: "ROOM",
          capacity: 2,
          isActive: false,
          provisioningSource: "PRODUCT",
        },
      ],
    });

    render(<FloorSelectLandingPage />);

    await screen.findByRole("list", { name: "층 선택 목록" });
    expect(screen.queryByRole("button", { name: "숨김층 이동, 위험 0건" })).toBeNull();
  });

  const breakoutClassPattern = /left-1\/2|w-screen|-translate-x-1\/2|calc\(100dvh-9\.5rem\)/;

  it("renders the main content branch on the shell's page-bleed track, not a viewport breakout", async () => {
    render(<FloorSelectLandingPage />);

    const heading = await screen.findByRole("heading", { name: "층 선택" });
    const section = heading.closest("section");
    expect(section).not.toBeNull();
    expect(section?.className).toMatch(/\bpage-bleed\b/);
    expect(section?.className ?? "").not.toMatch(breakoutClassPattern);
  });

  it("renders the loading branch on the shell's page-bleed track, not a viewport breakout", () => {
    vi.mocked(dashboardService.getDashboard).mockReturnValue(new Promise(() => {}));
    render(<FloorSelectLandingPage />);

    const loading = screen.getByText("층 선택 화면을 준비하는 중...");
    expect(loading.className).toMatch(/\bpage-bleed\b/);
    expect(loading.className).not.toMatch(breakoutClassPattern);
  });

  it("renders the error branch on the shell's page-bleed track, not a viewport breakout", async () => {
    vi.mocked(dashboardService.getDashboard).mockRejectedValue(new Error("boom"));
    render(<FloorSelectLandingPage />);

    const errorText = await screen.findByText("층 정보를 불러오지 못했습니다.");
    const errorRoot = errorText.parentElement;
    expect(errorRoot).not.toBeNull();
    expect(errorRoot?.className).toMatch(/\bpage-bleed\b/);
    expect(errorRoot?.className ?? "").not.toMatch(breakoutClassPattern);
  });
});
