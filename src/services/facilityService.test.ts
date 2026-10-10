import { beforeEach, describe, expect, it, vi } from "vitest";
import { listFacilities } from "@/services/api/dashboardEndpoints";
import { getFacility, getFacilityEdgeStatus, updateFacility } from "@/services/api/facilities";
import type { Facility, FacilityEdgeStatus } from "@/types";
import { facilityService } from "./facilityService";

vi.mock("@/services/api/dashboardEndpoints", () => ({
  listFacilities: vi.fn(),
}));

vi.mock("@/services/api/facilities", () => ({
  getFacility: vi.fn(),
  getFacilityEdgeStatus: vi.fn(),
  updateFacility: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("facilityService", () => {
  it("delegates without arguments and returns the endpoint result unchanged", async () => {
    const facilities: Facility[] = [
      {
        id: "facility-service-1",
        name: "Care Home",
        address: "123 Care Street",
        phone: "010-1234-5678",
      },
    ];
    const response = Promise.resolve(facilities);
    vi.mocked(listFacilities).mockReturnValue(response);

    const result = facilityService.listFacilities();

    expect(listFacilities).toHaveBeenCalledTimes(1);
    expect(listFacilities).toHaveBeenCalledWith();
    expect(result).toBe(response);
    await expect(result).resolves.toBe(facilities);
  });

  it("preserves an empty endpoint result", async () => {
    const facilities: Facility[] = [];
    vi.mocked(listFacilities).mockResolvedValue(facilities);

    await expect(facilityService.listFacilities()).resolves.toBe(facilities);
  });

  it("propagates the original endpoint error without a fallback", async () => {
    const error = new Error("Facility access denied");
    vi.mocked(listFacilities).mockRejectedValue(error);

    await expect(facilityService.listFacilities()).rejects.toBe(error);
    expect(listFacilities).toHaveBeenCalledTimes(1);
  });

  it("forwards the facility ID and preserves the facility promise and result", async () => {
    const facility: Facility = {
      id: "facility-service-1",
      name: "Care Home",
      address: "123 Care Street",
      phone: "010-1234-5678",
    };
    const response = Promise.resolve(facility);
    vi.mocked(getFacility).mockReturnValue(response);

    const result = facilityService.getFacility(facility.id);

    expect(getFacility).toHaveBeenCalledTimes(1);
    expect(getFacility).toHaveBeenCalledWith(facility.id);
    expect(result).toBe(response);
    await expect(result).resolves.toBe(facility);
  });

  it("propagates the original facility lookup error", async () => {
    const error = new Error("Facility not found");
    vi.mocked(getFacility).mockRejectedValue(error);

    await expect(facilityService.getFacility("facility-service-1")).rejects.toBe(error);
    expect(getFacility).toHaveBeenCalledTimes(1);
  });

  it("forwards the facility ID and preserves the edge-status promise and result", async () => {
    const status: FacilityEdgeStatus = {
      connectionState: "STALE",
      lastHeartbeatAt: null,
      lastSyncedAt: null,
      healthyCameraCount: 0,
      totalCameraCount: 4,
    };
    const response = Promise.resolve(status);
    vi.mocked(getFacilityEdgeStatus).mockReturnValue(response);

    const result = facilityService.getFacilityEdgeStatus("facility-service-1");

    expect(getFacilityEdgeStatus).toHaveBeenCalledTimes(1);
    expect(getFacilityEdgeStatus).toHaveBeenCalledWith("facility-service-1");
    expect(result).toBe(response);
    await expect(result).resolves.toBe(status);
  });

  it("propagates the original edge-status error", async () => {
    const error = new Error("Edge status unavailable");
    vi.mocked(getFacilityEdgeStatus).mockRejectedValue(error);

    await expect(facilityService.getFacilityEdgeStatus("facility-service-1")).rejects.toBe(error);
    expect(getFacilityEdgeStatus).toHaveBeenCalledTimes(1);
  });

  it("forwards the update payload unchanged and preserves the promise and result", async () => {
    const input: Pick<Facility, "name" | "address" | "phone"> = {
      name: "Updated Care Home",
      address: "",
      phone: "",
    };
    const facility: Facility = { id: "facility-service-1", ...input };
    const response = Promise.resolve(facility);
    vi.mocked(updateFacility).mockReturnValue(response);

    const result = facilityService.updateFacility(facility.id, input);

    expect(updateFacility).toHaveBeenCalledTimes(1);
    expect(updateFacility).toHaveBeenCalledWith(facility.id, input);
    expect(vi.mocked(updateFacility).mock.calls[0][1]).toBe(input);
    expect(result).toBe(response);
    await expect(result).resolves.toBe(facility);
  });

  it("propagates the original facility update error", async () => {
    const error = new Error("Facility update denied");
    vi.mocked(updateFacility).mockRejectedValue(error);

    await expect(
      facilityService.updateFacility("facility-service-1", {
        name: "Care Home",
        address: "",
        phone: "",
      }),
    ).rejects.toBe(error);
    expect(updateFacility).toHaveBeenCalledTimes(1);
  });
});
