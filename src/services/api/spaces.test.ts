import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSpace, deleteSpace, listSpaces, mapSpaceDto, updateSpace } from "./spaces";
import { requestJson } from "@/services/apiClient";

vi.mock("@/services/apiClient", () => ({
  requestJson: vi.fn(),
}));

const requestJsonMock = vi.mocked(requestJson);

const backendSpace = {
  id: "sp_201",
  facilityId: "fac_1",
  floorId: "fl_2",
  name: "201호",
  type: "ROOM" as const,
  capacity: 4,
  isActive: true,
  assignedStaff: null,
  provisioningSource: "PRODUCT" as const,
  createdAt: "2026-07-03T00:00:00.000Z",
};

describe("spaces api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps backend space DTOs to frontend spaces", () => {
    expect(mapSpaceDto({ ...backendSpace, assignedStaff: "김요양" })).toEqual({
      id: "sp_201",
      facilityId: "fac_1",
      floorId: "fl_2",
      name: "201호",
      type: "ROOM",
      capacity: 4,
      isActive: true,
      assignedStaff: "김요양",
      provisioningSource: "PRODUCT",
    });
  });

  it("lists spaces from the real backend path", async () => {
    requestJsonMock.mockResolvedValue([backendSpace]);

    await expect(listSpaces()).resolves.toEqual([
      {
        id: "sp_201",
        facilityId: "fac_1",
        floorId: "fl_2",
        name: "201호",
        type: "ROOM",
        capacity: 4,
        isActive: true,
        assignedStaff: undefined,
        provisioningSource: "PRODUCT",
      },
    ]);
    expect(requestJsonMock).toHaveBeenCalledWith("/spaces");
  });

  it("maps an EDGE-owned space and rejects an invalid provisioningSource", () => {
    expect(mapSpaceDto({ ...backendSpace, provisioningSource: "EDGE" })).toMatchObject({
      provisioningSource: "EDGE",
    });
    expect(() =>
      mapSpaceDto({ ...backendSpace, provisioningSource: "BOGUS" as never }),
    ).toThrow();
  });

  it("creates spaces with transitional backend-required type and capacity defaults", async () => {
    requestJsonMock.mockResolvedValue(backendSpace);
    const input = { floorId: "fl_2", name: "202호", isActive: true };

    await createSpace(input);

    expect(requestJsonMock).toHaveBeenCalledWith("/spaces", {
      method: "POST",
      body: JSON.stringify({
        type: "ROOM",
        capacity: 1,
        ...input,
      }),
    });
  });

  it("updates spaces with PATCH by id", async () => {
    requestJsonMock.mockResolvedValue({ ...backendSpace, isActive: false });

    await updateSpace("sp/201", { name: "201호", isActive: false });

    expect(requestJsonMock).toHaveBeenCalledWith("/spaces/sp%2F201", {
      method: "PATCH",
      body: JSON.stringify({ name: "201호", isActive: false }),
    });
  });

  it("lets explicit undefined override create defaults while retaining null and extra fields", async () => {
    requestJsonMock.mockResolvedValue(backendSpace);
    const input = {
      floorId: "fl_2",
      name: "202호",
      type: undefined,
      capacity: undefined,
      assignedStaff: null,
      extra: "kept",
    };

    await createSpace(input);

    expect(requestJsonMock).toHaveBeenCalledWith("/spaces", {
      method: "POST",
      body: '{"floorId":"fl_2","name":"202호","assignedStaff":null,"extra":"kept"}',
    });
  });

  it("retains explicit create overrides, falsy values, and existing property order", async () => {
    requestJsonMock.mockResolvedValue(backendSpace);
    const input = {
      floorId: "fl_2",
      name: "202호",
      type: "ETC" as const,
      capacity: -2.5,
      isActive: false,
      assignedStaff: "",
    };

    await createSpace(input);

    expect(requestJsonMock).toHaveBeenCalledWith("/spaces", {
      method: "POST",
      body: '{"type":"ETC","capacity":-2.5,"floorId":"fl_2","name":"202호","isActive":false,"assignedStaff":""}',
    });
  });

  it("preserves patch null and extra fields without injecting defaults", async () => {
    requestJsonMock.mockResolvedValue(backendSpace);
    const patch = {
      type: undefined,
      capacity: undefined,
      isActive: undefined,
      assignedStaff: null,
      extra: "kept",
    };

    await updateSpace("sp/201", patch);

    expect(requestJsonMock).toHaveBeenCalledWith("/spaces/sp%2F201", {
      method: "PATCH",
      body: '{"assignedStaff":null,"extra":"kept"}',
    });
  });

  it.each([
    { value: "2.5", expected: 2.5 },
    { value: -2.5, expected: -2.5 },
    { value: null, expected: 0 },
    { value: "", expected: 0 },
  ])("retains Number coercion for response capacity $value", async ({ value, expected }) => {
    requestJsonMock.mockResolvedValue([{ ...backendSpace, capacity: value }]);

    await expect(listSpaces()).resolves.toMatchObject([{ capacity: expected }]);
  });

  it("retains rejection of non-finite response capacity", async () => {
    requestJsonMock.mockResolvedValue([{ ...backendSpace, capacity: "Infinity" }]);

    await expect(listSpaces()).rejects.toThrow("Invalid space capacity");
  });

  it.each([null, undefined, 42, false])(
    "normalizes non-string response assignedStaff %s to undefined",
    async (assignedStaff) => {
      requestJsonMock.mockResolvedValue([{ ...backendSpace, assignedStaff }]);

      await expect(listSpaces()).resolves.toMatchObject([{ assignedStaff: undefined }]);
    },
  );

  it("retains the response space-type whitelist", async () => {
    requestJsonMock.mockResolvedValue([{ ...backendSpace, type: "room" }]);

    await expect(listSpaces()).rejects.toThrow("Invalid space type");
  });

  it("does not coerce response isActive strings to boolean", async () => {
    requestJsonMock.mockResolvedValue([{ ...backendSpace, isActive: "true" }]);

    await expect(listSpaces()).rejects.toThrow("Invalid space isActive");
  });

  it("retains the outer array guard for a null list response", async () => {
    requestJsonMock.mockResolvedValue(null);

    await expect(listSpaces()).rejects.toThrow("Invalid spaces response");
  });

  it.each([
    { operation: "list", response: [null], run: () => listSpaces() },
    { operation: "create", response: null, run: () => createSpace({ floorId: "fl_2", name: "202호" }) },
    { operation: "update", response: null, run: () => updateSpace("sp_201", { name: "202호" }) },
    { operation: "delete", response: null, run: () => deleteSpace("sp_201") },
  ])("preserves malformed null row failure for $operation", async ({ response, run }) => {
    requestJsonMock.mockResolvedValue(response);

    await expect(run()).rejects.toThrow(TypeError);
  });

  it("deletes spaces with DELETE and parses the returned space DTO", async () => {
    requestJsonMock.mockResolvedValue(backendSpace);

    await expect(deleteSpace("sp/201")).resolves.toMatchObject({ id: "sp_201", name: "201호" });

    expect(requestJsonMock).toHaveBeenCalledWith("/spaces/sp%2F201", { method: "DELETE" });
  });
});
