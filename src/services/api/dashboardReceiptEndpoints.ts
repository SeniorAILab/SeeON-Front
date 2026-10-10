import { requestJson } from "@/services/apiClient";
import type { DashboardReceiptKind, DashboardReceiptResponse } from "@/types/dashboardReceipt";
import type { DashboardReceiptRequestDto } from "./dashboard/dto/dashboard-receipt-request.dto";
import type { DashboardReceiptResponseDto } from "./dashboard/dto/dashboard-receipt-response.dto";

export async function postDashboardReceipt(
  kind: DashboardReceiptKind,
  body: DashboardReceiptRequestDto,
): Promise<DashboardReceiptResponse> {
  const value = await requestJson(`/dashboard/receipts/${kind}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return mapDashboardReceiptDto(value, kind);
}

function mapDashboardReceiptDto(
  value: unknown,
  kind: DashboardReceiptKind,
): DashboardReceiptResponse {
  if (!isDashboardReceiptResponse(value, kind)) {
    throw new Error("Invalid dashboard receipt response");
  }
  return value;
}

function isDashboardReceiptResponse(
  value: unknown,
  kind: DashboardReceiptKind,
): value is DashboardReceiptResponse {
  if (!value || typeof value !== "object") return false;
  const receipt = value as DashboardReceiptResponseDto;
  const idKey = kind === "delivery" ? "deliveryId" : "presentationId";
  return (
    typeof receipt[idKey] === "string" &&
    typeof receipt.backendEventId === "string" &&
    typeof receipt.alertId === "string" &&
    typeof receipt.alertSeq === "string" &&
    receipt.kind === kind
  );
}
