import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SystemTestAlertBanner } from "./SystemTestAlertBanner";
import type { DetectionEvent } from "@/types";

function systemAlert(id: string, backendEventId: string): DetectionEvent {
  return {
    id,
    backendEventId,
    alertSeq: id.endsWith("2") ? "2" : "1",
    facilityId: "facility-system-test",
    residentId: null,
    cameraId: null,
    spaceId: null,
    eventType: "SYSTEM_TEST",
    riskLevel: "LOW",
    message: "SYSTEM TEST - NOT A RESIDENT ALERT",
    aiSummary: "SYSTEM TEST - NOT A RESIDENT ALERT",
    detectedAt: "2026-08-12T00:00:00.000Z",
    alertStatus: "PENDING",
    actions: [],
    emergency: false,
    testMode: "SYSTEM_TEST",
    label: "SYSTEM TEST - NOT A RESIDENT ALERT",
    ttsText: "System test emergency notification",
  } as DetectionEvent;
}

describe("SystemTestAlertBanner", () => {
  it("deduplicates a replay by alert identity while keeping distinct events visible", () => {
    const first = systemAlert("alert-system-1", "event-system-1");
    const second = systemAlert("alert-system-2", "event-system-2");
    const { container } = render(<SystemTestAlertBanner alerts={[first, first, second]} />);

    expect(screen.getAllByText("SYSTEM TEST")).toHaveLength(2);
    const cards = container.querySelectorAll('[data-test-mode="SYSTEM_TEST"]');
    expect(cards).toHaveLength(2);
    expect(cards[0].getAttribute("data-alert-id")).toBe("alert-system-1");
    expect(cards[0].getAttribute("data-backend-event-id")).toBe("event-system-1");
    expect(cards[0].getAttribute("data-correlation-id")).toBe("event-system-1");
    expect(cards[0].textContent).not.toContain("호");
  });
});
