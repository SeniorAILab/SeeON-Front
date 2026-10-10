import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, requestJson, requestResponse } from "@/services/apiClient";
import { AlertMediaResponseError, AlertMediaDownloadError } from "@/lib/alertMediaErrors";
import {
  buildAlertMediaContentPath,
  getAlertMediaEndpoint,
  parseAlertMedia,
  recordAlertMediaAccessEndpoint,
} from "./alertMedia";
import {
  canDownloadAlertAttachment,
  downloadAlertMediaAttachment,
} from "./alertMediaDownloads";

vi.mock("@/services/apiClient", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
  buildApiUrl: (path: string) => `/api/v1${path}`,
  requestJson: vi.fn(),
  requestResponse: vi.fn(),
}));

const requestJsonMock = vi.mocked(requestJson);
const requestResponseMock = vi.mocked(requestResponse);

const READY_RESPONSE = {
  status: "READY",
  alertId: "alert-1",
  clip: {
    contentType: "video/mp4",
    detectedAt: "2026-07-16T00:00:10.000Z",
    clipStartAt: "2026-07-16T00:00:00.000Z",
    clipEndAt: "2026-07-16T00:00:20.000Z",
    durationSeconds: 20,
  },
} as const;

describe("alert media API seam", () => {
  beforeEach(() => {
    requestJsonMock.mockReset();
    requestResponseMock.mockReset();
  });

  it("loads and parses READY metadata with an encoded alert-only route", async () => {
    const controller = new AbortController();
    requestJsonMock.mockResolvedValue({
      ...READY_RESPONSE,
      alertId: "alert/a b",
    });

    const media = await getAlertMediaEndpoint("alert/a b", controller.signal);

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/alerts/alert%2Fa%20b/media",
      { signal: controller.signal },
    );
    expect(media).toEqual({ ...READY_RESPONSE, alertId: "alert/a b" });
  });

  it("derives the same-origin content path without a token or clip identifier", () => {
    const path = buildAlertMediaContentPath("alert/a b");

    expect(path).toBe("/api/v1/alerts/alert%2Fa%20b/media/content");
    expect(path).not.toContain("token");
    expect(path).not.toContain("clip-1");
  });

  it("posts only the confirmed interaction action to the alert route", async () => {
    requestJsonMock.mockResolvedValue({ accepted: true });

    await recordAlertMediaAccessEndpoint({
      alertId: "alert/a b",
      action: "FULLSCREEN_ENTERED",
      interactionId: "interaction-1",
    });

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/alerts/alert%2Fa%20b/media/access",
      {
        method: "POST",
        body: JSON.stringify({
          action: "FULLSCREEN_ENTERED",
          interactionId: "interaction-1",
        }),
      },
    );
  });

  it("forwards access cancellation without serializing controls or extra request fields", async () => {
    const controller = new AbortController();
    const request = {
      alertId: "alert/a b",
      action: "PLAY_STARTED" as const,
      interactionId: "",
      signal: controller.signal,
      extra: "not-a-body-field",
    };
    requestJsonMock.mockResolvedValue({ accepted: true });

    await expect(recordAlertMediaAccessEndpoint(request)).resolves.toBeUndefined();

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/alerts/alert%2Fa%20b/media/access",
      {
        method: "POST",
        body: '{"action":"PLAY_STARTED","interactionId":""}',
        signal: controller.signal,
      },
    );
  });
});

describe("alert media attachment download", () => {
  it("downloads an authenticated attachment through the shared response seam", async () => {
    requestResponseMock.mockResolvedValue(
      new Response("clip", {
        status: 200,
        headers: {
          "Content-Disposition": 'attachment; filename="incident-clip.mp4"',
          "Content-Length": "4",
          "Content-Type": "video/mp4",
          "Cache-Control": "private, no-store, no-transform",
          "Accept-Ranges": "bytes",
          ETag: `"sha256-${"d".repeat(64)}"`,
        },
      }),
    );

    const attachment = await downloadAlertMediaAttachment({
      alertId: "alert/a b",
    });

    expect(requestResponseMock).toHaveBeenCalledWith(
      "/alerts/alert%2Fa%20b/media/download",
      {
        method: "GET",
      },
    );
    expect(attachment.filename).toBe("incident-clip.mp4");
    expect(attachment.content.size).toBe(4);
  });

  it("maps unauthorized download failures without exposing the response body", async () => {
    requestResponseMock.mockRejectedValue(
      new ApiError(401, "private backend detail"),
    );

    await expect(
      downloadAlertMediaAttachment({ alertId: "alert-1" }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "AlertMediaDownloadError",
        status: 401,
        code: "UNAUTHORIZED",
      }),
    );
  });

  it("rejects unsafe attachment metadata", async () => {
    requestResponseMock.mockResolvedValue(
      new Response("clip", {
        status: 200,
        headers: {
          "Content-Disposition": 'attachment; filename="../incident.mp4"',
          "Content-Length": "4",
          "Content-Type": "video/mp4",
          "Cache-Control": "private, no-store, no-transform",
          "Accept-Ranges": "bytes",
          ETag: `"sha256-${"d".repeat(64)}"`,
        },
      }),
    );

    await expect(
      downloadAlertMediaAttachment({ alertId: "alert-1" }),
    ).rejects.toBeInstanceOf(AlertMediaDownloadError);
  });

  it("exposes the facility-admin download capability without changing route policy", () => {
    expect(canDownloadAlertAttachment("SUPER_ADMIN")).toBe(true);
    expect(canDownloadAlertAttachment("ADMIN")).toBe(true);
    expect(canDownloadAlertAttachment("STAFF")).toBe(false);
  });
});

describe("parseAlertMedia", () => {
  it.each([{ value: null }, { value: [] }, { value: "not-an-object" }])(
    "rejects malformed roots before field parsing: $value",
    ({ value }) => {
      expect(() => parseAlertMedia(value, "alert-1")).toThrow("root must be an object");
    },
  );

  it("checks alert identity before status parsing and exact-key validation", () => {
    expect(() =>
      parseAlertMedia({ alertId: "other-alert", status: 42, extra: true }, "alert-1"),
    ).toThrow("alertId does not match request");
  });

  it("rejects an empty alert identifier even when it matches the requested value", () => {
    expect(() => parseAlertMedia({ status: "UNAVAILABLE", alertId: "" }, "")).toThrow(
      "alertId must be a non-empty string",
    );
  });

  it.each([0, Number.MAX_SAFE_INTEGER + 1, 1e20])(
    "accepts nonnegative integer retry %s without imposing a safe-integer cap",
    (retryAfterSeconds) => {
      const response = { status: "PENDING", alertId: "alert-1", retryAfterSeconds };
      expect(parseAlertMedia(response, "alert-1")).toEqual(response);
    },
  );

  it.each([-1, 0.5, "0", Infinity])("rejects invalid retry %s", (retryAfterSeconds) => {
    expect(() =>
      parseAlertMedia({ status: "PENDING", alertId: "alert-1", retryAfterSeconds }, "alert-1"),
    ).toThrow("retryAfterSeconds must be a non-negative integer or null");
  });

  it.each(["", ".1", ".12", ".123"])("accepts UTC instants with fraction %s", (fraction) => {
    const response = {
      status: "EXPIRED",
      alertId: "alert-1",
      expiredAt: `2026-07-16T00:00:00${fraction}Z`,
    };
    expect(parseAlertMedia(response, "alert-1")).toEqual(response);
  });

  it.each([
    "2026-07-16T00:00:00+00:00",
    "2026-07-16T00:00:00.1234Z",
    "2026-99-16T00:00:00Z",
  ])("retains UTC syntax and finite-date rejection for %s", (expiredAt) => {
    expect(() =>
      parseAlertMedia({ status: "EXPIRED", alertId: "alert-1", expiredAt }, "alert-1"),
    ).toThrow("expiredAt must be an RFC3339 UTC instant");
  });

  it("rejects an empty timestamp before the UTC syntax check", () => {
    expect(() =>
      parseAlertMedia({ status: "DELETED", alertId: "alert-1", deletedAt: "" }, "alert-1"),
    ).toThrow("deletedAt must be a non-empty string");
  });

  it.each([READY_RESPONSE.clip.clipStartAt, READY_RESPONSE.clip.clipEndAt])(
    "accepts inclusive detection boundary %s and an independent fractional duration",
    (detectedAt) => {
      const response = {
        ...READY_RESPONSE,
        clip: { ...READY_RESPONSE.clip, detectedAt, durationSeconds: 0.5 },
      };
      expect(parseAlertMedia(response, "alert-1")).toEqual(response);
    },
  );

  it.each([
    { status: "UNAVAILABLE", alertId: "alert-1", extra: true },
    { status: "PENDING", alertId: "alert-1" },
  ])("retains exact root-key validation for %j", (response) => {
    expect(() => parseAlertMedia(response, "alert-1")).toThrow(
      "response contains unexpected fields",
    );
  });

  it("retains separate metadata and clip copies after validation", () => {
    const media = parseAlertMedia(READY_RESPONSE, "alert-1");

    expect(media).toEqual(READY_RESPONSE);
    expect(media).not.toBe(READY_RESPONSE);
    if (media.status !== "READY") throw new Error("Expected READY metadata");
    expect(media.clip).not.toBe(READY_RESPONSE.clip);
  });

  it.each([
    [
      { status: "PENDING", alertId: "alert-1", retryAfterSeconds: null },
      "PENDING",
    ],
    [READY_RESPONSE, "READY"],
    [{ status: "UNAVAILABLE", alertId: "alert-1" }, "UNAVAILABLE"],
    [
      {
        status: "EXPIRED",
        alertId: "alert-1",
        expiredAt: "2026-07-16T01:00:00.000Z",
      },
      "EXPIRED",
    ],
    [
      {
        status: "DELETED",
        alertId: "alert-1",
        deletedAt: "2026-07-16T01:00:00.000Z",
      },
      "DELETED",
    ],
  ])("accepts the closed %s lifecycle branch", (response, expectedStatus) => {
    expect(parseAlertMedia(response, "alert-1").status).toBe(expectedStatus);
  });

  it.each([
    {
      name: "route alert mismatch",
      response: { ...READY_RESPONSE, alertId: "different-alert" },
    },
    {
      name: "unknown lifecycle",
      response: { ...READY_RESPONSE, status: "UNKNOWN" },
    },
    {
      name: "forbidden clip identifier",
      response: {
        ...READY_RESPONSE,
        clip: { ...READY_RESPONSE.clip, id: "clip-1" },
      },
    },
    {
      name: "zero duration",
      response: {
        ...READY_RESPONSE,
        clip: { ...READY_RESPONSE.clip, durationSeconds: 0 },
      },
    },
    {
      name: "invalid instant",
      response: {
        ...READY_RESPONSE,
        clip: { ...READY_RESPONSE.clip, detectedAt: "invalid" },
      },
    },
    {
      name: "invalid timestamp order",
      response: {
        ...READY_RESPONSE,
        clip: {
          ...READY_RESPONSE.clip,
          clipStartAt: "2026-07-16T00:00:11.000Z",
        },
      },
    },
  ])("rejects malformed metadata: $name", ({ response }) => {
    expect(() => parseAlertMedia(response, "alert-1")).toThrow(
      AlertMediaResponseError,
    );
  });
});
