export type DashboardReceiptKind = "delivery" | "presentation";

interface DashboardReceiptFields {
  backendEventId: string;
  alertId: string;
  alertSeq: string;
  // Acknowledgement validates identity fields, not the remaining server metadata.
  surface?: unknown;
  observedAt?: unknown;
  recordedAt?: unknown;
  duplicate?: unknown;
}

export type DashboardReceiptResponse = DashboardReceiptFields & (
  | { kind: "delivery"; deliveryId: string; presentationId?: unknown }
  | { kind: "presentation"; presentationId: string; deliveryId?: unknown }
);
