import { beforeEach, describe, expect, it, vi } from "vitest";
const SCOPED_FACILITY_ID = "fac_happy_nokyang";


function okJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const facility = {
  id: SCOPED_FACILITY_ID,
  name: "Happy Nokyang",
  address: "Seoul",
  phone: "02-0000-0000",
};

const floors = [{ id: "floor_2", facilityId: facility.id, name: "2F", orderIndex: 2 }];

const spaces = [
  {
    id: "sp_201",
    facilityId: facility.id,
    floorId: "floor_2",
    name: "201호",
    type: "ROOM",
    capacity: 1,
    isActive: true,
  },
];

const rawListCases = [
  {
    operation: "listFacilities" as const,
    path: "/facilities",
    field: "facilities",
    rows: [null, { ...facility, address: null, phone: null, extra: "kept" }],
  },
  {
    operation: "listFloors" as const,
    path: "/floors",
    field: "floors",
    rows: [null, { ...floors[0], orderIndex: "2.5", extra: "kept" }],
  },
  {
    operation: "listSpaces" as const,
    path: "/spaces",
    field: "spaces",
    rows: [null, { ...spaces[0], assignedStaff: null, capacity: "1.5", extra: "kept" }],
  },
];

const residentStatuses = [
  {
    id: "resident-status-1",
    residentId: "res_201_a",
    state: "STABLE",
    lastSeenAt: "2026-06-22T00:00:00.000Z",
  },
];

const bedExitAlert = {
  alertSeq: "10",
  id: "alert_201",
  facilityId: facility.id,
  residentId: null,
  cameraId: "cam_sp_201",
  spaceId: "sp_201",
  room: "201호",
  type: "bed-exit",
  probability: 0.92,
  detectedAt: "2026-06-22T01:00:00.000Z",
  status: "SENT",
};

describe("dashboardEndpoints", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(rawListCases)(
    "$operation retains raw arrays and rows without element normalization",
    async ({ operation, path, rows }) => {
      const expected = rows.map((row) => row === null ? null : { ...row });
      const client = await import("@/services/apiClient");
      const request = vi.spyOn(client, "requestJson").mockResolvedValue(rows);
      const endpoints = await import("./dashboardEndpoints");

      const result = await endpoints[operation]();

      expect(request).toHaveBeenCalledWith(path);
      expect(result).toBe(rows);
      expect(result[1]).toBe(rows[1]);
      expect(result).toEqual(expected);
    },
  );

  it.each(rawListCases.flatMap(({ operation, field }) =>
    [null, {}, "not-an-array"].map((body) => ({ operation, field, body })),
  ))("$operation retains its outer-array rejection for $body", async ({ operation, field, body }) => {
    const client = await import("@/services/apiClient");
    vi.spyOn(client, "requestJson").mockResolvedValue(body);
    const endpoints = await import("./dashboardEndpoints");

    await expect(endpoints[operation]()).rejects.toThrow(`Invalid ${field} response`);
  });

  it.each(rawListCases)("$operation preserves transport error identity", async ({ operation }) => {
    const failure = new Error("transport failure");
    const client = await import("@/services/apiClient");
    vi.spyOn(client, "requestJson").mockRejectedValue(failure);
    const endpoints = await import("./dashboardEndpoints");

    await expect(endpoints[operation]()).rejects.toBe(failure);
  });

  it.each([
    { body: { ...facility, address: null, phone: null, extra: "kept" } },
    { body: null },
  ])("retains unvalidated current-facility identity for $body", async ({ body }) => {
    const expected = body === null ? null : { ...body };
    const client = await import("@/services/apiClient");
    const request = vi.spyOn(client, "requestJson").mockImplementation(async (path) => {
      if (path === "/auth/me") {
        return { id: "user-1", role: "ADMIN", facilityId: facility.id };
      }
      return body;
    });
    const { getCurrentFacility } = await import("./dashboardEndpoints");

    const result = await getCurrentFacility();

    expect(result).toBe(body);
    expect(result).toEqual(expected);
    expect(request).toHaveBeenCalledWith(`/facilities/${facility.id}`);
  });

  it("retains the missing current-facility error", async () => {
    const client = await import("@/services/apiClient");
    vi.spyOn(client, "requestJson").mockResolvedValue({
      id: "user-1",
      role: "ADMIN",
      facilityId: null,
    });
    const { getCurrentFacility } = await import("./dashboardEndpoints");

    await expect(getCurrentFacility()).rejects.toThrow("현재 시설 정보를 찾을 수 없습니다.");
  });

  it("hydrates room statuses from spaces and overlays room-level alerts without mis-keying resident status", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) {
        return okJsonResponse({
          id: "user-1",
          email: "admin@sen.ai",
          nickname: "원장",
          role: "ADMIN",
          facilityId: facility.id,
        });
      }
      if (url.endsWith(`/facilities/${facility.id}`)) return okJsonResponse(facility);
      if (url.endsWith("/floors")) return okJsonResponse(floors);
      if (url.endsWith("/spaces")) return okJsonResponse(spaces);
      if (url.endsWith("/alerts")) return okJsonResponse([bedExitAlert]);
      if (url.endsWith("/status")) return okJsonResponse(residentStatuses);
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getDashboardFromBackend } = await import("./dashboardEndpoints");
    const dashboard = await getDashboardFromBackend();

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/status"),
      expect.anything()
    );
    expect(dashboard.statuses).not.toHaveProperty("undefined");
    expect(dashboard.statuses.sp_201).toMatchObject({
      spaceId: "sp_201",
      status: "DANGER",
      alertStatus: "SENT",
      bedsideActivity: true,
      emergency: false,
    });
    expect(dashboard.unacknowledgedEvents).toHaveLength(1);
    expect(dashboard.summary.danger).toBe(1);
  });

  it("keeps alerts for inactive spaces out of dashboard statuses and summary totals", async () => {
    const inactiveSpace = { ...spaces[0], id: "sp_202", name: "202호", isActive: false };
    const inactiveSpaceAlert = {
      ...bedExitAlert,
      id: "alert_202",
      cameraId: "cam_sp_202",
      spaceId: inactiveSpace.id,
      room: inactiveSpace.name,
    };
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) {
        return okJsonResponse({
          id: "user-1",
          email: "admin@sen.ai",
          nickname: "원장",
          role: "ADMIN",
          facilityId: facility.id,
        });
      }
      if (url.endsWith(`/facilities/${facility.id}`)) return okJsonResponse(facility);
      if (url.endsWith("/floors")) return okJsonResponse(floors);
      if (url.endsWith("/spaces")) return okJsonResponse([...spaces, inactiveSpace]);
      if (url.endsWith("/alerts")) return okJsonResponse([bedExitAlert, inactiveSpaceAlert]);
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getDashboardFromBackend } = await import("./dashboardEndpoints");
    const dashboard = await getDashboardFromBackend();

    expect(dashboard.spaces).toHaveLength(2);
    expect(dashboard.statuses).toEqual(
      expect.objectContaining({
        sp_201: expect.objectContaining({ spaceId: "sp_201", status: "DANGER" }),
      })
    );
    expect(dashboard.statuses).not.toHaveProperty(inactiveSpace.id);
    expect(dashboard.summary).toMatchObject({ totalSpaces: 1, danger: 1 });
    expect(dashboard.unacknowledgedEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: inactiveSpaceAlert.id })])
    );
  });
  it("gets the current facility through /auth/me then /facilities/:id", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) {
        return okJsonResponse({
          id: "user-1",
          email: "admin@sen.ai",
          nickname: "원장",
          role: "ADMIN",
          facilityId: facility.id,
        });
      }
      if (url.endsWith(`/facilities/${facility.id}`)) return okJsonResponse(facility);
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getCurrentFacility } = await import("./dashboardEndpoints");
    await expect(getCurrentFacility()).resolves.toEqual(facility);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/me",
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/facilities/${facility.id}`,
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("exposes role dashboard read-model paths using facility scope", async () => {
    const { dashboardReadModelPath } = await import("./dashboardEndpoints");

    expect(dashboardReadModelPath.superAdmin()).toBe("/dashboards/super-admin");
    expect(dashboardReadModelPath.facilityAdmin("fac-a")).toBe(
      "/dashboards/facilities/fac-a/admin"
    );
    expect(dashboardReadModelPath.facilityStaff("fac-a")).toBe(
      "/dashboards/facilities/fac-a/staff"
    );
    expect(dashboardReadModelPath.facilityMonitor("fac-a", "fl-2f")).toBe(
      "/dashboards/facilities/fac-a/monitor?floorId=fl-2f"
    );
  });

  it("lists facilities through the backend facility selector endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/facilities")) return okJsonResponse([facility]);
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { listFacilities } = await import("./dashboardEndpoints");
    await expect(listFacilities()).resolves.toEqual([facility]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/facilities",
      expect.objectContaining({ credentials: "include" })
    );
  });
});
