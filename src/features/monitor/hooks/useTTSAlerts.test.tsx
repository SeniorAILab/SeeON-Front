import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTTSAlerts } from "./useTTSAlerts";
import { __setTTSFailureForTest } from "@/features/monitor/services/tts/ttsManager";

const updateMock = vi.hoisted(() => vi.fn());
const retryMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/monitor/services/tts/ttsManager", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/features/monitor/services/tts/ttsManager")
  >();
  return {
    ...actual,
    ttsManager: { update: updateMock },
    retryPendingTTSFromTrustedInteraction: retryMock,
  };
});

describe("useTTSAlerts", () => {
  beforeEach(() => {
    updateMock.mockClear();
    retryMock.mockReset();
    __setTTSFailureForTest(null);
  });

  it("retries a pre-existing blocked failure once and removes both listeners after success", () => {
    __setTTSFailureForTest("blocked");
    retryMock.mockReturnValue(true);
    renderHook(() => useTTSAlerts([], true));

    act(() => document.dispatchEvent(new Event("pointerdown")));
    act(() => document.dispatchEvent(new Event("keydown")));

    expect(retryMock).toHaveBeenCalledTimes(1);
  });

  it("does not install trusted-interaction retry while audio is disabled", () => {
    __setTTSFailureForTest("blocked");
    renderHook(() => useTTSAlerts([], false));

    act(() => document.dispatchEvent(new Event("pointerdown")));

    expect(retryMock).not.toHaveBeenCalled();
  });

  it("removes blocked-failure retry listeners when the hook unmounts", () => {
    __setTTSFailureForTest("blocked");
    const { unmount } = renderHook(() => useTTSAlerts([], true));

    unmount();
    act(() => document.dispatchEvent(new Event("pointerdown")));

    expect(retryMock).not.toHaveBeenCalled();
  });

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
