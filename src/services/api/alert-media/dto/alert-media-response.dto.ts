export interface ReadyAlertMediaClipDto {
  contentType: "video/mp4";
  detectedAt: string;
  clipStartAt: string;
  clipEndAt: string;
  durationSeconds: number;
}

export type AlertMediaResponseDto =
  | {
      status: "PENDING";
      alertId: string;
      retryAfterSeconds: number | null;
    }
  | {
      status: "READY";
      alertId: string;
      clip: ReadyAlertMediaClipDto;
    }
  | { status: "UNAVAILABLE"; alertId: string }
  | {
      status: "EXPIRED";
      alertId: string;
      expiredAt: string;
    }
  | {
      status: "DELETED";
      alertId: string;
      deletedAt: string;
    };
