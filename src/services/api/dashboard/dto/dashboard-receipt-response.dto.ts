export interface DashboardReceiptResponseDto {
  deliveryId?: string;
  presentationId?: string;
  backendEventId: string;
  alertId: string;
  alertSeq: string;
  kind: "delivery" | "presentation";
  surface: string;
  observedAt: string;
  recordedAt: string;
  duplicate: boolean;
}
