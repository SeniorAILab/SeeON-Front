export interface DashboardReceiptRequestDto {
  dashboardClientId: string;
  backendEventId: string;
  alertId: string;
  alertSeq: string;
  observedAt: string;
  surface?: string;
}
