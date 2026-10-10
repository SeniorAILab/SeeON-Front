import { buildApiUrl, requestJson } from "@/services/apiClient";
import { AlertMediaResponseError } from "@/lib/alertMediaErrors";
import type {
  AlertMediaResponseDto,
  ReadyAlertMediaClipDto,
} from "./alert-media/dto/alert-media-response.dto";
import type { RecordAlertMediaAccessRequestDto } from "./alert-media/dto/record-alert-media-access-request.dto";
import type {
  AlertMediaAccessRequest,
  AlertMediaMetadata,
  ReadyAlertMediaClip,
} from "@/types/alertMedia";

export async function getAlertMediaEndpoint(
  alertId: string,
  signal: AbortSignal,
): Promise<AlertMediaMetadata> {
  const body = await requestJson(
    `/alerts/${encodeURIComponent(alertId)}/media`,
    { signal },
  );
  return parseAlertMedia(body, alertId);
}

export function buildAlertMediaContentPath(alertId: string): string {
  return buildApiUrl(`/alerts/${encodeURIComponent(alertId)}/media/content`);
}

export async function recordAlertMediaAccessEndpoint(
  request: AlertMediaAccessRequest,
): Promise<void> {
  const options: RequestInit = {
    method: "POST",
    body: JSON.stringify({
      action: request.action,
      interactionId: request.interactionId,
    } satisfies RecordAlertMediaAccessRequestDto),
  };
  if (request.signal !== undefined) options.signal = request.signal;
  await requestJson(
    `/alerts/${encodeURIComponent(request.alertId)}/media/access`,
    options,
  );
}

export function parseAlertMedia(
  value: unknown,
  requestedAlertId: string,
): AlertMediaMetadata {
  const record = readRecord(value, "root");
  const alertId = readString(record, "alertId");
  if (alertId !== requestedAlertId) {
    throw new AlertMediaResponseError("alertId does not match request");
  }

  const status = readString(record, "status");
  switch (status) {
    case "PENDING":
      requireExactKeys(record, ["status", "alertId", "retryAfterSeconds"]);
      return {
        status,
        alertId,
        retryAfterSeconds: readRetryAfterSeconds(record.retryAfterSeconds),
      } satisfies AlertMediaResponseDto;
    case "READY":
      requireExactKeys(record, ["status", "alertId", "clip"]);
      return { status, alertId, clip: readReadyClip(record.clip) } satisfies AlertMediaResponseDto;
    case "UNAVAILABLE":
      requireExactKeys(record, ["status", "alertId"]);
      return { status, alertId } satisfies AlertMediaResponseDto;
    case "EXPIRED":
      requireExactKeys(record, ["status", "alertId", "expiredAt"]);
      return {
        status,
        alertId,
        expiredAt: readInstant(record, "expiredAt"),
      } satisfies AlertMediaResponseDto;
    case "DELETED":
      requireExactKeys(record, ["status", "alertId", "deletedAt"]);
      return {
        status,
        alertId,
        deletedAt: readInstant(record, "deletedAt"),
      } satisfies AlertMediaResponseDto;
    default:
      throw new AlertMediaResponseError(`unknown status ${status}`);
  }
}

function readReadyClip(value: unknown): ReadyAlertMediaClip {
  const clip = readRecord(value, "clip");
  requireExactKeys(clip, [
    "contentType",
    "detectedAt",
    "clipStartAt",
    "clipEndAt",
    "durationSeconds",
  ]);
  const contentType = readString(clip, "contentType");
  if (contentType !== "video/mp4") {
    throw new AlertMediaResponseError("clip.contentType must be video/mp4");
  }
  const detectedAt = readInstant(clip, "detectedAt");
  const clipStartAt = readInstant(clip, "clipStartAt");
  const clipEndAt = readInstant(clip, "clipEndAt");
  const durationSeconds = clip.durationSeconds;
  if (
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    throw new AlertMediaResponseError("clip.durationSeconds must be positive");
  }
  const startTime = Date.parse(clipStartAt);
  const detectionTime = Date.parse(detectedAt);
  const endTime = Date.parse(clipEndAt);
  if (startTime > detectionTime || detectionTime > endTime) {
    throw new AlertMediaResponseError("clip timestamps are out of order");
  }
  return {
    contentType,
    detectedAt,
    clipStartAt,
    clipEndAt,
    durationSeconds,
  } satisfies ReadyAlertMediaClipDto;
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AlertMediaResponseError(`${field} must be an object`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new AlertMediaResponseError(`${field} must be a non-empty string`);
  }
  return value;
}

function readInstant(record: Record<string, unknown>, field: string): string {
  const value = readString(record, field);
  const rfc3339Utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
  if (!rfc3339Utc.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new AlertMediaResponseError(`${field} must be an RFC3339 UTC instant`);
  }
  return value;
}

function readRetryAfterSeconds(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new AlertMediaResponseError(
      "retryAfterSeconds must be a non-negative integer or null",
    );
  }
  return value;
}

function requireExactKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const keys = Object.keys(record);
  if (
    keys.length !== allowedKeys.length ||
    keys.some((key) => !allowedKeys.includes(key))
  ) {
    throw new AlertMediaResponseError("response contains unexpected fields");
  }
}
