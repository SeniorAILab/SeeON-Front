import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFloor, deleteFloor, listFloors, mapFloorDto, updateFloor } from "./floors";
import { requestJson, requestNoContent } from "@/services/apiClient";

vi.mock("@/services/apiClient", () => ({
  requestJson: vi.fn(),
  requestNoContent: vi.fn(),
}));

const requestJsonMock = vi.mocked(requestJson);
const requestNoContentMock = vi.mocked(requestNoContent);

const backendFloor = {
  id: "fl_1",
  facilityId: "fac_1",
  name: "2F",
  orderIndex: 2,
  isActive: true,
  provisioningSource: "PRODUCT" as const,
  createdAt: "2026-07-03T00:00:00.000Z",
};

describe("floors api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps backend floor DTOs to frontend floors", () => {
    expect(mapFloorDto(backendFloor)).toEqual({
      id: "fl_1",
      facilityId: "fac_1",
      name: "2F",
      orderIndex: 2,
      provisioningSource: "PRODUCT",
    });
  });

  it("lists floors from the real backend path", async () => {
    requestJsonMock.mockResolvedValue([backendFloor]);

    await expect(listFloors()).resolves.toEqual([
      {
        id: "fl_1",
        facilityId: "fac_1",
        name: "2F",
        orderIndex: 2,
        provisioningSource: "PRODUCT",
      },
    ]);
    expect(requestJsonMock).toHaveBeenCalledWith("/floors");
  });

  it("creates floors with POST body parsing", async () => {
    requestJsonMock.mockResolvedValue(backendFloor);

    await createFloor({ name: "3F", orderIndex: 3 });

    expect(requestJsonMock).toHaveBeenCalledWith("/floors", {
      method: "POST",
      body: JSON.stringify({ name: "3F", orderIndex: 3 }),
    });
  });

  it("updates floors with PATCH by id", async () => {
    requestJsonMock.mockResolvedValue({ ...backendFloor, name: "3F" });

    await updateFloor("fl/1", { name: "3F" });

    expect(requestJsonMock).toHaveBeenCalledWith("/floors/fl%2F1", {
      method: "PATCH",
      body: JSON.stringify({ name: "3F" }),
    });
  });

  it("preserves extra create fields and omits explicit undefined without defaults", async () => {
    requestJsonMock.mockResolvedValue(backendFloor);
    const input = { name: "3F", orderIndex: undefined, extra: "kept" };

    await createFloor(input);

    expect(requestJsonMock).toHaveBeenCalledWith("/floors", {
      method: "POST",
      body: '{"name":"3F","extra":"kept"}',
    });
  });

  it("preserves patch extras and fractional negative order without input validation", async () => {
    requestJsonMock.mockResolvedValue(backendFloor);
    const patch = { name: undefined, orderIndex: -1.5, extra: "kept" };

    await updateFloor("fl/1", patch);

    expect(requestJsonMock).toHaveBeenCalledWith("/floors/fl%2F1", {
      method: "PATCH",
      body: '{"orderIndex":-1.5,"extra":"kept"}',
    });
  });

  it.each([
    { value: "2.5", expected: 2.5 },
    { value: -1.5, expected: -1.5 },
    { value: null, expected: 0 },
    { value: "", expected: 0 },
    { value: false, expected: 0 },
    { value: true, expected: 1 },
  ])("retains Number coercion for response orderIndex $value", async ({ value, expected }) => {
    requestJsonMock.mockResolvedValue([{ ...backendFloor, orderIndex: value }]);

    await expect(listFloors()).resolves.toMatchObject([{ orderIndex: expected }]);
  });

  it.each([undefined, "not-a-number", "Infinity", "-Infinity"])(
    "rejects non-finite response orderIndex %s",
    async (orderIndex) => {
      requestJsonMock.mockResolvedValue([{ ...backendFloor, orderIndex }]);

      await expect(listFloors()).rejects.toThrow("Invalid floor orderIndex");
    },
  );

  it("retains the outer array guard for a null list response", async () => {
    requestJsonMock.mockResolvedValue(null);

    await expect(listFloors()).rejects.toThrow("Invalid floors response");
  });

  it.each([
    { operation: "list", response: [null], run: () => listFloors() },
    { operation: "create", response: null, run: () => createFloor({ name: "3F" }) },
    { operation: "update", response: null, run: () => updateFloor("fl_1", { name: "3F" }) },
  ])("preserves malformed null row failure for $operation", async ({ response, run }) => {
    requestJsonMock.mockResolvedValue(response);

    await expect(run()).rejects.toThrow(TypeError);
  });

  it("maps an EDGE-owned floor and rejects an invalid provisioningSource", () => {
    expect(mapFloorDto({ ...backendFloor, provisioningSource: "EDGE" })).toMatchObject({
      provisioningSource: "EDGE",
    });
    expect(() =>
      mapFloorDto({ ...backendFloor, provisioningSource: "BOGUS" as never }),
    ).toThrow();
  });

  it("deletes floors with DELETE and no response body", async () => {
    requestNoContentMock.mockResolvedValue(undefined);

    await deleteFloor("fl/1");

    expect(requestNoContentMock).toHaveBeenCalledWith("/floors/fl%2F1", { method: "DELETE" });
  });
});
