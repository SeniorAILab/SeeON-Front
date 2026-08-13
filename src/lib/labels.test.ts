import { describe, expect, it } from "vitest";
import { detectionEventPresentationFor, displayEventTypeLabel, eventPresentationFor, eventTypeLabel } from "./labels";
import type { DetectionEventType } from "@/types";

const knownEventTypes: Record<DetectionEventType, string> = {
  STABLE: "안정 상태",
  MOVEMENT_INCREASE: "움직임 증가",
  REPEATED_STANDING_ATTEMPT: "반복 기립 시도",
  FALL_RISK: "낙상 위험",
  SOLO_MOVEMENT: "혼자 이동 시도",
  PROLONGED_INACTIVITY: "장시간 미움직임",
  WANDERING: "배회 감지",
  BED_EXIT: "침대 이탈",
  OTHER: "기타 감지",
};

describe("eventTypeLabel", () => {
  it("labels every known detection event type", () => {
    for (const [type, label] of Object.entries(knownEventTypes)) {
      expect(eventTypeLabel[type]).toBe(label);
    }
  });

  it("safely falls back to the original value for unknown detection event types", () => {
    expect(eventTypeLabel.UNKNOWN_BACKEND_TYPE).toBe("알 수 없는 이벤트(UNKNOWN_BACKEND_TYPE)");
  });

  it("uses the original string even when the unknown type matches an object prototype key", () => {
    expect(eventTypeLabel.constructor).toBe("알 수 없는 이벤트(constructor)");
  });

  it("uses backendType for OTHER events when the backend sent an unknown type", () => {
    expect(displayEventTypeLabel({ eventType: "OTHER", backendType: "door-open-too-long" })).toBe(
      "알 수 없는 이벤트(door-open-too-long)"
    );
  });

  it("keeps the known OTHER label when no backend type is available", () => {
    expect(displayEventTypeLabel({ eventType: "OTHER" })).toBe("기타 감지");
  });

  it("labels a kebab-case backendType registered in eventPresentationFor instead of leaking the raw wire string", () => {
    // mapEventType()이 detection-lost를 OTHER로 뭉개도, 그 값이 kebab-case
    // 레지스트리에 등록돼 있으면 "알 수 없는 이벤트(detection-lost)"가 아니라
    // 정식 한글 제목이 나와야 한다.
    expect(displayEventTypeLabel({ eventType: "OTHER", backendType: "detection-lost" })).toBe("감지 끊김");
  });

  it("still degrades to the safe unknown-event fallback for a backendType in neither registry", () => {
    expect(displayEventTypeLabel({ eventType: "OTHER", backendType: "some-future-event-type" })).toBe(
      "알 수 없는 이벤트(some-future-event-type)"
    );
  });
});

describe("detectionEventPresentationFor", () => {
  const allEventTypes: DetectionEventType[] = [
    "STABLE",
    "MOVEMENT_INCREASE",
    "REPEATED_STANDING_ATTEMPT",
    "FALL_RISK",
    "SOLO_MOVEMENT",
    "PROLONGED_INACTIVITY",
    "WANDERING",
    "BED_EXIT",
    "OTHER",
  ];

  it("(a) every DetectionEventType key returns an icon + non-empty Korean title", () => {
    for (const eventType of allEventTypes) {
      const presentation = detectionEventPresentationFor(eventType);
      expect(presentation.icon).toBeTruthy();
      expect(presentation.title).toMatch(/[가-힣]/);
      expect(presentation.phrase).toBeTruthy();
    }
  });

  it("(b) FALL_RISK and BED_EXIT severity === high", () => {
    expect(detectionEventPresentationFor("FALL_RISK").severity).toBe("high");
    expect(detectionEventPresentationFor("BED_EXIT").severity).toBe("high");
  });

  it("(c) OTHER with backendType 'bed-exit' resolves title '침대 이탈'", () => {
    const presentation = detectionEventPresentationFor("OTHER", { backendType: "bed-exit" });
    expect(presentation.title).toBe("침대 이탈");
  });

  it("(d) OTHER with unregistered backendType never returns the raw string in the title", () => {
    const presentation = detectionEventPresentationFor("OTHER", { backendType: "weird-thing" });
    expect(presentation.title).not.toBe("weird-thing");
    expect(presentation.title).toMatch(/[가-힣]/);
  });

  it("OTHER with empty-string backendType returns safe fallback without crash", () => {
    expect(() => detectionEventPresentationFor("OTHER", { backendType: "" })).not.toThrow();
    const presentation = detectionEventPresentationFor("OTHER", { backendType: "" });
    expect(presentation.title).not.toBe("");
  });

  it("OTHER without backendType returns safe fallback without crash", () => {
    expect(() => detectionEventPresentationFor("OTHER")).not.toThrow();
    const presentation = detectionEventPresentationFor("OTHER");
    expect(presentation.title).toBeTruthy();
  });
});

describe("eventPresentationFor", () => {
  const knownWireTypes = [
    "fall",
    "bed-exit",
    "prolonged-inactivity",
    "wandering",
    "repeated-standing-attempt",
    "solo-movement",
    "detection-lost",
  ];

  it("resolves every known wire event type to an icon, a Korean title, and a severity", () => {
    for (const type of knownWireTypes) {
      const presentation = eventPresentationFor(type);
      expect(presentation.icon).toBeTruthy();
      expect(presentation.title).toMatch(/[가-힣]/);
      expect(["high", "medium"]).toContain(presentation.severity);
      expect(presentation.phrase).toMatch(/[가-힣]/);
    }
  });

  it("never leaks the raw wire string as a title", () => {
    for (const type of knownWireTypes) {
      expect(eventPresentationFor(type).title).not.toBe(type);
    }
  });

  it('falls back to "새 안전 알림" for an unregistered event type, never the raw string', () => {
    expect(eventPresentationFor("some-future-event-type").title).toBe("새 안전 알림");
  });

  it('falls back to "새 안전 알림" for an empty string without throwing', () => {
    expect(() => eventPresentationFor("")).not.toThrow();
    expect(eventPresentationFor("").title).toBe("새 안전 알림");
  });

  it("does not fall back for the ingest-contract wire types (locked by alert-event-type-contract.spec.ts)", () => {
    // 백엔드 ingest 계약은 정확히 ['detection-lost','bed-exit','fall']로 잠겨 있다.
    // 이 세 값은 반드시 등록된 표시 정보를 가져야 하며 unknown 폴백으로 새지 않는다.
    for (const type of ["detection-lost", "bed-exit", "fall"]) {
      expect(eventPresentationFor(type).title).not.toBe("새 안전 알림");
    }
  });
});
