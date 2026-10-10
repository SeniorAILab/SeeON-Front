import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestJson } from "@/services/apiClient";
import {
  replaceEdgeInstallation,
  transferEdgeOwnership,
} from "./edgeInstallationAdmin";

vi.mock("@/services/apiClient", () => ({ requestJson: vi.fn() }));

const requestJsonMock = vi.mocked(requestJson);
const INSTALLATION_ID = "c72bd9a7-3e04-47ba-a8cd-a56e54f98152";
const CLIENT_REF = "8b0f5ba2-d359-4d8e-948f-e386ac40c347";
const OPERATION_ID = "0197f671-3a31-7a6c-a6e4-83ed412de801";
const TOKEN_ID = "7H2K9M4QXP3R";
const ONE_TIME_VALUE = ["eft_v1", TOKEN_ID, "s".repeat(43)].join(".");
const MANIFEST_DIGEST = "a".repeat(64);

const OPERATION = {
  operationId: OPERATION_ID,
  status: "SUCCEEDED",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as const;

describe("edge installation admin API seam", () => {
  beforeEach(() => {
    requestJsonMock.mockReset();
  });

  it("replaces an installation and returns a consumable one-time credential", async () => {
    requestJsonMock.mockResolvedValue({
      schemaVersion: 1,
      operation: OPERATION,
      edgeInstallationId: INSTALLATION_ID,
      previousEnrollmentGeneration: 1,
      enrollmentGeneration: 2,
      installationState: "PENDING_CLAIM",
      oneTimeDisplay: {
        redacted: false,
        tokenId: TOKEN_ID,
        prefix: "eft_v1.7H2K9M4QXP3R.[redacted]",
        value: ONE_TIME_VALUE,
      },
    });

    const result = await replaceEdgeInstallation({
      edgeInstallationId: INSTALLATION_ID,
      expectedEnrollmentGeneration: 1,
      newClientInstallationRef: CLIENT_REF,
      idempotencyKey: OPERATION_ID,
    });

    expect(requestJsonMock).toHaveBeenCalledWith(
      `/admin/edge-installations/${INSTALLATION_ID}/replace`,
      expect.objectContaining({
        method: "POST",
        headers: { "Idempotency-Key": OPERATION_ID },
      }),
    );
    expect(result.kind).toBe("initial");
    if (result.kind !== "initial") return;
    expect(result.oneTimeCredential.consume()).toBe(ONE_TIME_VALUE);
    expect(result.oneTimeCredential.consume()).toBeNull();
  });

  it.each([
    { generation: -1.5, serialized: "-1.5" },
    { generation: NaN, serialized: "null" },
    { generation: Infinity, serialized: "null" },
  ])("preserves replacement serialization for generation $generation", async ({ generation, serialized }) => {
    const failure = new Error("transport failure");
    const controller = new AbortController();
    requestJsonMock.mockRejectedValue(failure);
    const request = {
      edgeInstallationId: "installation/a b",
      expectedEnrollmentGeneration: generation,
      newClientInstallationRef: "",
      idempotencyKey: " untrimmed-key ",
      signal: controller.signal,
      extra: "not-a-body-field",
    };

    await expect(replaceEdgeInstallation(request)).rejects.toBe(failure);

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/admin/edge-installations/installation%2Fa%20b/replace",
      {
        method: "POST",
        headers: { "Idempotency-Key": " untrimmed-key " },
        body: `{"schemaVersion":1,"expectedEnrollmentGeneration":${serialized},"newClientInstallationRef":""}`,
        signal: controller.signal,
      },
    );
    expect(requestJsonMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it("preserves transfer manifest order, item extras, null parents and unvalidated values", async () => {
    const failure = new Error("transport failure");
    const controller = new AbortController();
    requestJsonMock.mockRejectedValue(failure);
    const manifest = [
      {
        kind: "CAMERA",
        edgeRef: "z-camera",
        canonicalId: "",
        parentCanonicalId: null,
        extra: "kept",
      },
      {
        kind: "CAMERA",
        edgeRef: "a-camera",
        canonicalId: " id ",
        parentCanonicalId: " parent ",
      },
    ] as const;
    const request = {
      edgeInstallationId: "installation/a b",
      expectedEnrollmentGeneration: -0.5,
      expectedServerRevision: NaN,
      manifestDigest: "",
      manifest,
      idempotencyKey: " untrimmed-key ",
      signal: controller.signal,
      extra: "not-a-body-field",
    };

    await expect(transferEdgeOwnership(request)).rejects.toBe(failure);

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/admin/edge-installations/installation%2Fa%20b/transfers",
      {
        method: "POST",
        headers: { "Idempotency-Key": " untrimmed-key " },
        body: '{"schemaVersion":1,"expectedEnrollmentGeneration":-0.5,"expectedServerRevision":null,"manifestDigest":"","manifest":[{"kind":"CAMERA","edgeRef":"z-camera","canonicalId":"","parentCanonicalId":null,"extra":"kept"},{"kind":"CAMERA","edgeRef":"a-camera","canonicalId":" id ","parentCanonicalId":" parent "}]}',
        signal: controller.signal,
      },
    );
    expect(requestJsonMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it("omits an explicitly undefined signal and forwards an empty manifest", async () => {
    const failure = new Error("transport failure");
    requestJsonMock.mockRejectedValue(failure);

    await expect(transferEdgeOwnership({
      edgeInstallationId: INSTALLATION_ID,
      expectedEnrollmentGeneration: 0,
      expectedServerRevision: 0,
      manifestDigest: " untrimmed-digest ",
      manifest: [],
      idempotencyKey: OPERATION_ID,
      signal: undefined,
    })).rejects.toBe(failure);

    expect(requestJsonMock).toHaveBeenCalledWith(
      `/admin/edge-installations/${INSTALLATION_ID}/transfers`,
      {
        method: "POST",
        headers: { "Idempotency-Key": OPERATION_ID },
        body: '{"schemaVersion":1,"expectedEnrollmentGeneration":0,"expectedServerRevision":0,"manifestDigest":" untrimmed-digest ","manifest":[]}',
      },
    );
    expect(requestJsonMock.mock.calls[0][1]).not.toHaveProperty("signal");
  });

  it("submits the confirmed ownership-transfer manifest", async () => {
    requestJsonMock.mockResolvedValue({
      schemaVersion: 1,
      operation: OPERATION,
      edgeInstallationId: INSTALLATION_ID,
      enrollmentGeneration: 2,
      serverRevision: 4,
      transferred: { floors: 1, rooms: 1, cameras: 1 },
      appliedAt: "2026-01-01T00:05:00.000Z",
    });
    const manifest = [
      {
        kind: "CAMERA",
        edgeRef: "camera-001",
        canonicalId: "a5ff4ed1-7e63-4a4f-9ef0-42e807d74a64",
        parentCanonicalId: "8b0f5ba2-d359-4d8e-948f-e386ac40c347",
      },
    ] as const;

    const result = await transferEdgeOwnership({
      edgeInstallationId: INSTALLATION_ID,
      expectedEnrollmentGeneration: 2,
      expectedServerRevision: 3,
      manifestDigest: MANIFEST_DIGEST,
      manifest,
      idempotencyKey: OPERATION_ID,
    });

    expect(result.transferred).toEqual({ floors: 1, rooms: 1, cameras: 1 });
    expect(requestJsonMock).toHaveBeenCalledWith(
      `/admin/edge-installations/${INSTALLATION_ID}/transfers`,
      expect.objectContaining({ body: JSON.stringify({
        schemaVersion: 1,
        expectedEnrollmentGeneration: 2,
        expectedServerRevision: 3,
        manifestDigest: MANIFEST_DIGEST,
        manifest,
      }) }),
    );
  });


});
