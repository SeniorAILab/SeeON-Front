import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playTTS } from "./playTTS";
import { TTSManager, type TTSIncidentAlertInput } from "./ttsManager";

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

function incident(
  identity: string,
  spaceId: string,
  name: string,
  level: "EMERGENCY" | "DANGER" | "CAUTION" = "DANGER",
): TTSIncidentAlertInput {
  return { identity, kind: "INCIDENT", spaceId, name, level, reason: "", floorName: "1층" };
}

const text = {
  emergency: "101호에서 응급 발생, 확인이 필요합니다",
  danger1: "102호에서 위험 발생, 확인이 필요합니다",
  danger2: "103호에서 위험 발생, 확인이 필요합니다",
  caution: "105호에서 주의 발생, 확인이 필요합니다",
};

function spokenTexts() {
  return playTTSMock.mock.calls.map(([spoken]) => spoken);
}

describe("TTSManager first-announcement fairness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    playTTSMock.mockClear();
    playTTSMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("speaks a never-spoken lower-severity incident before simultaneous higher-severity reannouncements", async () => {
    const manager = new TTSManager();
    const emergency = incident("event-emergency", "space-1", "101호", "EMERGENCY");
    const danger1 = incident("event-danger-1", "space-2", "102호", "DANGER");
    const danger2 = incident("event-danger-2", "space-3", "103호", "DANGER");

    manager.update([emergency, danger1, danger2], true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spokenTexts()).toEqual([text.emergency, text.danger1, text.danger2]);

    // First announcements ran at t=1s and are reannounce-eligible at t=31s.
    // Add a new CAUTION incident at t=30s, so its first announcement and every high-severity
    // reannouncement become due in exactly the same t=31s tick.
    await vi.advanceTimersByTimeAsync(29_000);
    manager.update([emergency, danger1, danger2, incident("event-new-caution", "space-5", "105호", "CAUTION")], true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(spokenTexts().slice(3)).toEqual([
      text.caution,
      text.emergency,
      text.danger1,
      text.danger2,
    ]);
  });

  it("keeps a brand-new EMERGENCY ahead of cohort-0 CAUTION and all reannouncements", async () => {
    const manager = new TTSManager();
    const existingEmergency = incident("event-existing-emergency", "space-1", "101호", "EMERGENCY");
    const existingDanger = incident("event-existing-danger", "space-2", "102호", "DANGER");
    const newEmergency = incident("event-new-emergency", "space-4", "104호", "EMERGENCY");

    manager.update([existingEmergency, existingDanger], true);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(29_000);

    manager.update(
      [existingEmergency, existingDanger, incident("event-new-caution-with-emergency", "space-5", "105호", "CAUTION"), newEmergency],
      true,
    );
    await vi.advanceTimersByTimeAsync(1_000);

    expect(spokenTexts().slice(2)).toEqual([
      "104호에서 응급 발생, 확인이 필요합니다",
      text.caution,
      text.emergency,
      text.danger1,
    ]);
  });

  it("preserves same-level cross-tick enqueue sequence", async () => {
    const manager = new TTSManager();
    const blocker = deferred<{ ok: true }>();
    const secondPlayback = deferred<{ ok: true }>();
    playTTSMock
      .mockReturnValueOnce(blocker.promise)
      .mockReturnValueOnce(secondPlayback.promise);

    const first = incident("event-first", "space-1", "101호");
    const second = incident("event-second", "space-2", "102호");
    const third = incident("event-third", "space-3", "103호");

    manager.update([first], true);
    await vi.advanceTimersByTimeAsync(1_000);
    manager.update([first, second], true);
    await vi.advanceTimersByTimeAsync(1_000);
    manager.update([first, second, third], true);
    await vi.advanceTimersByTimeAsync(1_000);

    blocker.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(spokenTexts()).toEqual([
      "101호에서 위험 발생, 확인이 필요합니다",
      "102호에서 위험 발생, 확인이 필요합니다",
    ]);

    secondPlayback.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(spokenTexts()).toEqual([
      "101호에서 위험 발생, 확인이 필요합니다",
      "102호에서 위험 발생, 확인이 필요합니다",
      "103호에서 위험 발생, 확인이 필요합니다",
    ]);
  });

  it("preserves severity order among reannouncements", async () => {
    const manager = new TTSManager();
    const emergency = incident("event-emergency-reannounce", "space-1", "101호", "EMERGENCY");
    const danger = incident("event-danger-reannounce", "space-2", "102호", "DANGER");

    manager.update([danger, emergency], true);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(spokenTexts()).toEqual([
      text.emergency,
      text.danger1,
      text.emergency,
      text.danger1,
    ]);
  });

  it("treats an escalation as a first announcement ahead of reannouncements", async () => {
    const manager = new TTSManager();
    const existingEmergency = incident("event-existing-reannounce", "space-1", "101호", "EMERGENCY");
    const escalating = incident("event-escalating", "space-2", "102호", "DANGER");

    manager.update([existingEmergency, escalating], true);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(29_000);

    const escalated = incident("event-escalating", "space-2", "102호", "EMERGENCY");
    manager.update([existingEmergency, escalated, incident("event-new-caution-escalation", "space-5", "105호", "CAUTION")], true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(spokenTexts().slice(2)).toEqual([
      "102호에서 응급 발생, 확인이 필요합니다",
      text.caution,
      text.emergency,
    ]);
  });

  it("refreshes a stale queued reannouncement when its identity escalates while already queued", async () => {
    const manager = new TTSManager();
    const emergency = incident("event-emergency-queued-escalation", "space-1", "101호", "EMERGENCY");
    const danger1 = incident("event-danger-1-queued-escalation", "space-2", "102호", "DANGER");
    const danger2 = incident("event-danger-2-queued-escalation", "space-3", "103호", "DANGER");

    manager.update([emergency, danger1, danger2], true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spokenTexts()).toEqual([text.emergency, text.danger1, text.danger2]);

    // All three become reannounce-eligible together at t=31s. Block the
    // emergency's reannouncement mid-flight so danger1's reannouncement is
    // pushed into `this.queue` but never drained.
    const blocker = deferred<{ ok: true }>();
    playTTSMock.mockReturnValueOnce(blocker.promise);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(spokenTexts()).toHaveLength(4);
    expect(spokenTexts()[3]).toBe(text.emergency);

    // danger1 now escalates to EMERGENCY while its stale DANGER
    // reannouncement utterance is still sitting, undrained, in the queue.
    // A new CAUTION incident also arrives in the same update.
    const escalatedDanger1 = incident("event-danger-1-queued-escalation", "space-2", "102호", "EMERGENCY");
    manager.update(
      [emergency, escalatedDanger1, danger2, incident("event-new-caution-queued-escalation", "space-5", "105호", "CAUTION")],
      true,
    );
    await vi.advanceTimersByTimeAsync(1_000);

    // Let the blocked emergency reannouncement finish so the queue drains.
    blocker.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    // Exactly one utterance for the escalated identity, refreshed to the new
    // EMERGENCY text/priority and placed in the first-announcement cohort
    // ahead of the new CAUTION incident and the still-DANGER reannouncement.
    expect(spokenTexts().slice(4)).toEqual([
      "102호에서 응급 발생, 확인이 필요합니다",
      text.caution,
      text.danger2,
    ]);
    // text.danger1 was legitimately spoken once as the pre-escalation first
    // announcement; the stale queued DANGER reannouncement must never speak.
    expect(
      spokenTexts().filter((spoken) => spoken === text.danger1).length,
    ).toBe(1);
  });
});
