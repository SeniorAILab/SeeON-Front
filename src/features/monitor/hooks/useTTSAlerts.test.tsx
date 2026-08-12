import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTTSAlerts } from "./useTTSAlerts";

const updateMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/monitor/services/tts/ttsManager", () => ({
  ttsManager: { update: updateMock },
}));

describe("useTTSAlerts", () => {
  beforeEach(() => updateMock.mockClear());

  it("silences the TTS manager when the monitor unmounts", () => {
    const { unmount } = renderHook(() =>
      useTTSAlerts(
        [{ identity: "event-unmount", kind: "INCIDENT", spaceId: "space_alert", name: "101호", level: "DANGER", reason: "낙상 위험", floorName: "1층" }],
        true,
      ),
    );

    unmount();

    expect(updateMock).toHaveBeenLastCalledWith([], false);
  });

  it("synchronizes two distinct alert identities in the same space", () => {
    const first = [{ identity: "event-1", kind: "INCIDENT" as const, spaceId: "space_alert", name: "101호", level: "DANGER" as const, reason: "", floorName: "1층" }];
    const second = [{ identity: "event-2", kind: "INCIDENT" as const, spaceId: "space_alert", name: "101호", level: "DANGER" as const, reason: "", floorName: "1층" }];

    const { rerender } = renderHook(
      ({ alerts }) => useTTSAlerts(alerts, true),
      { initialProps: { alerts: first } },
    );
    rerender({ alerts: second });

    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenLastCalledWith(second, true);
  });
});
