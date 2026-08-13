import { describe, expect, it } from "vitest";
import { buildTTSAlerts } from "./useTTSAlerts";
import type { DetectionEvent, Floor, Space, SpaceStatus } from "@/types";

const facilityId = "facility-tts-test";
const floor: Floor = { id: "floor-1", facilityId, name: "1층", orderIndex: 1, provisioningSource: "PRODUCT" };
const space: Space = { id: "space-1", facilityId, floorId: floor.id, name: "101호", type: "ROOM", capacity: 1, isActive: true, provisioningSource: "PRODUCT" };
const dangerStatus: SpaceStatus = {
  id: "status-space-1",
  spaceId: space.id,
  peopleCount: 0,
  movementLevel: "HIGH",
  fallRiskLevel: "HIGH",
  status: "DANGER",
  connection: "LIVE",
  lastSeenAt: "2026-08-12T00:00:00.000Z",
  aiSummary: "",
  lastDetectedAt: "2026-08-12T00:00:00.000Z",
  alertStatus: "PENDING",
  emergency: true,
};

function incident(id: string, eventType: "FALL_RISK" | "BED_EXIT"): DetectionEvent {
  return {
    id: `alert-${id}`,
    backendEventId: `event-${id}`,
    alertSeq: id.endsWith("2") ? "2" : "1",
    facilityId,
    spaceId: space.id,
    residentId: null,
    cameraId: "camera-1",
    room: space.name,
    eventType,
    riskLevel: "HIGH",
    message: "",
    aiSummary: "",
    detectedAt: "2026-08-12T00:00:00.000Z",
    alertStatus: "PENDING",
    emergency: eventType === "FALL_RISK",
  };
}

describe("buildTTSAlerts", () => {
  it("deduplicates replay by event identity and keeps distinct same-space events", () => {
    const first = incident("1", "BED_EXIT");
    const second = incident("2", "FALL_RISK");

    const result = buildTTSAlerts([space], { [space.id]: dangerStatus }, [floor], [first, first, second]);

    expect(result.map((alert) => alert.identity)).toEqual(["event-1", "event-2"]);
    expect(result.map((alert) => alert.level)).toEqual(["DANGER", "EMERGENCY"]);
  });


});
