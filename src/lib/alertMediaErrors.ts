export class AlertMediaResponseError extends Error {
  readonly name = "AlertMediaResponseError";

  constructor(readonly reason: string) {
    super(`Malformed alert media response: ${reason}`);
  }
}

export type AlertMediaDownloadErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "UNAVAILABLE"
  | "RANGE_NOT_SATISFIABLE"
  | "UNEXPECTED";

export class AlertMediaDownloadError extends Error {
  readonly name = "AlertMediaDownloadError";

  constructor(
    readonly status: number,
    readonly code: AlertMediaDownloadErrorCode,
  ) {
    super("Alert media attachment download failed.");
  }
}
