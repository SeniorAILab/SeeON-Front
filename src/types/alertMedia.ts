export type ReadyAlertMediaClip = {
  readonly contentType: "video/mp4";
  readonly detectedAt: string;
  readonly clipStartAt: string;
  readonly clipEndAt: string;
  readonly durationSeconds: number;
};

export type AlertMediaMetadata =
  | {
      readonly status: "PENDING";
      readonly alertId: string;
      readonly retryAfterSeconds: number | null;
    }
  | {
      readonly status: "READY";
      readonly alertId: string;
      readonly clip: ReadyAlertMediaClip;
    }
  | { readonly status: "UNAVAILABLE"; readonly alertId: string }
  | {
      readonly status: "EXPIRED";
      readonly alertId: string;
      readonly expiredAt: string;
    }
  | {
      readonly status: "DELETED";
      readonly alertId: string;
      readonly deletedAt: string;
    };

export type AlertMediaAccessAction = "PLAY_STARTED" | "FULLSCREEN_ENTERED";

export type AlertMediaAccessRequest = {
  readonly alertId: string;
  readonly action: AlertMediaAccessAction;
  readonly interactionId: string;
  readonly signal?: AbortSignal;
};

export type AlertMediaDownloadRequest = {
  readonly alertId: string;
  readonly signal?: AbortSignal;
};

type AlertMediaAttachmentBase = {
  readonly content: Blob;
  readonly filename: string;
  readonly contentType: "video/mp4";
  readonly byteLength: number;
};

export type FullAlertMediaAttachment = AlertMediaAttachmentBase & {
  readonly kind: "full";
};

export type PartialAlertMediaAttachment = AlertMediaAttachmentBase & {
  readonly kind: "partial";
  readonly range: {
    readonly start: number;
    readonly end: number;
    readonly total: number;
  };
};

export type AlertMediaAttachment =
  | FullAlertMediaAttachment
  | PartialAlertMediaAttachment;
