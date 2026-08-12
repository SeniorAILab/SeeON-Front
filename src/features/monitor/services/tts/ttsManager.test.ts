import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playTTS } from "./playTTS";
import { TTSManager, type TTSAlertInput } from "./ttsManager";

vi.mock("./playTTS", () => ({
  playTTS: vi.fn(() => Promise.resolve({ ok: true })),
  cancelTTS: vi.fn(),
}));

const playTTSMock = vi.mocked(playTTS);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function incident(identity: string, spaceId = "space-1", level: "EMERGENCY" | "DANGER" | "CAUTION" = "DANGER"): TTSAlertInput {
  return {
    identity,
    kind: "INCIDENT",
    spaceId,
    name: "101호",
    level,
    reason: "",
    floorName: "1층",
  } as TTSAlertInput;
}

function systemTest(identity: string): TTSAlertInput {
  return {
    identity,
    kind: "SYSTEM_TEST",
    spaceId: null,
    name: null,
    level: "CAUTION",
    reason: "",
    floorName: null,
    testMode: "SYSTEM_TEST",
    ttsText: "System test emergency notification",
  } as TTSAlertInput;
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

  it("speaks the fixed SYSTEM_TEST payload and never a room emergency phrase", async () => {
    const manager = new TTSManager();

    manager.update([systemTest("event-system-test-tts")], true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(playTTSMock).toHaveBeenCalledWith("System test emergency notification");
    expect(playTTSMock.mock.calls[0]?.[0]).not.toContain("101호");
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

  it("keeps the immediate queue bounded while preserving insertion order", async () => {
    const manager = new TTSManager();
    const alerts = Array.from({ length: 250 }, (_, index) =>
      incident(`event-bounded-${index}`, `space-${index}`),
    );

    manager.update(alerts, true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(playTTSMock).toHaveBeenCalledTimes(200);
  });

  it("keeps normal bed-exit danger speech unchanged", async () => {
    const manager = new TTSManager();

    manager.update([incident("event-normal-bed-exit")], true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(playTTSMock).toHaveBeenCalledWith("101호에서 위험 발생, 확인이 필요합니다");
  });
});
