import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playTTS } from "./playTTS";
import {
  TTSManager,
  retryPendingTTSFromTrustedInteraction,
  ttsManager,
  type TTSIncidentAlertInput,
} from "./ttsManager";

vi.mock("./playTTS", () => ({
  playTTS: vi.fn(() => Promise.resolve({ ok: true })),
  cancelTTS: vi.fn(),
}));

const playTTSMock = vi.mocked(playTTS);

describe("trusted TTS retry boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retries exactly once for a trusted interaction", () => {
    const retry = vi.spyOn(ttsManager, "retryPendingOnUserGesture");

    expect(retryPendingTTSFromTrustedInteraction({ isTrusted: true })).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("rejects scripted interactions without retrying", () => {
    const retry = vi.spyOn(ttsManager, "retryPendingOnUserGesture");

    expect(retryPendingTTSFromTrustedInteraction({ isTrusted: false })).toBe(false);
    expect(retry).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function incident(
  identity: string,
  spaceId = "space-1",
  level: "EMERGENCY" | "DANGER" | "CAUTION" = "DANGER",
): TTSIncidentAlertInput {
  return {
    identity,
    kind: "INCIDENT",
    spaceId,
    name: "101호",
    level,
    reason: "",
    floorName: "1층",
  };
}

describe("TTSManager event identity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    playTTSMock.mockClear();
    playTTSMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("retries an active due alert immediately from a user gesture when enabled", () => {
    const manager = new TTSManager();

    manager.update([incident("event-gesture-retry")], true);
    manager.retryPendingOnUserGesture();

    expect(playTTSMock).toHaveBeenCalledWith("101호에서 위험 발생, 확인이 필요합니다");
  });

  it("does not retry pending alerts from a user gesture when disabled", () => {
    const manager = new TTSManager();

    manager.update([incident("event-disabled-gesture-retry")], false);
    manager.retryPendingOnUserGesture();

    expect(playTTSMock).not.toHaveBeenCalled();
  });

  it("does not speak the same event again after replay, removal, and reconnect", async () => {
    const manager = new TTSManager();
    const alert = incident("event-replay-1");

    manager.update([alert], true);
    await vi.advanceTimersByTimeAsync(1_000);
    manager.update([], true);
    manager.update([alert], true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(playTTSMock).toHaveBeenCalledTimes(1);
  });

  it("speaks two distinct event identities in the same space in priority order", async () => {
    const manager = new TTSManager();

    manager.update([
      incident("event-danger", "space-shared", "DANGER"),
      incident("event-emergency", "space-shared", "EMERGENCY"),
    ], true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(playTTSMock).toHaveBeenCalledTimes(2);
    expect(playTTSMock.mock.calls.map(([text]) => text)).toEqual([
      "101호에서 응급 발생, 확인이 필요합니다",
      "101호에서 위험 발생, 확인이 필요합니다",
    ]);
  });

  it("does not let a cancelled playback completion drain a replacement queue concurrently", async () => {
    const manager = new TTSManager();
    const cancelled = deferred<{ ok: true }>();
    const replacement = deferred<{ ok: true }>();
    playTTSMock
      .mockReturnValueOnce(cancelled.promise)
      .mockReturnValueOnce(replacement.promise);

    manager.update([incident("event-cancelled")], true);
    await vi.advanceTimersByTimeAsync(1_000);
    manager.update([], false);
    manager.update([incident("event-replacement-1"), incident("event-replacement-2")], true);
    await vi.advanceTimersByTimeAsync(1_000);

    cancelled.resolve({ ok: true });
    await Promise.resolve();
    expect(playTTSMock).toHaveBeenCalledTimes(2);

    replacement.resolve({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(playTTSMock).toHaveBeenCalledTimes(3);
  });

  it("retains the 30s, 120s, and 300s re-announcement schedule", async () => {
    const manager = new TTSManager();

    manager.update([incident("event-reannounce")], true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(playTTSMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(playTTSMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(playTTSMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(119_999);
    expect(playTTSMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(playTTSMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(299_999);
    expect(playTTSMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(playTTSMock).toHaveBeenCalledTimes(4);
  });

  it("does not truncate distinct equal-priority normal incidents and preserves insertion order", async () => {
    const manager = new TTSManager();
    const alerts = Array.from({ length: 250 }, (_, index) => ({
      ...incident(`event-unbounded-${index}`, `space-${index}`),
      name: `${index}호`,
    }));

    manager.update(alerts, true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(playTTSMock).toHaveBeenCalledTimes(250);
    expect(playTTSMock.mock.calls.map(([text]) => text)).toEqual(
      alerts.map((alert) => `${alert.name}에서 위험 발생, 확인이 필요합니다`),
    );
  });

  it("keeps normal bed-exit danger speech unchanged", async () => {
    const manager = new TTSManager();

    manager.update([incident("event-normal-bed-exit")], true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(playTTSMock).toHaveBeenCalledWith("101호에서 위험 발생, 확인이 필요합니다");
  });
});
