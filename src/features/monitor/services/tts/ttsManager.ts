// =============================================================
// TTS alert manager - priority queue + re-announce schedule.
// Transport replay is deduplicated by alert/backend-event identity, never space.
// =============================================================
import { playTTS, cancelTTS } from "./playTTS";
import type { TTSFailureReason } from "./ttsProvider";
import { textFor } from "./audioMap";
import type { AudioLevel } from "./ttsConfig";
import { SYSTEM_TEST_TTS_TEXT, type SystemTestMode } from "@/types";

export type TTSLevel = "EMERGENCY" | "DANGER" | "CAUTION";

interface TTSAlertBase {
  identity: string;
  level: TTSLevel;
  reason: string;
}

export interface TTSIncidentAlertInput extends TTSAlertBase {
  kind: "INCIDENT";
  spaceId: string;
  name: string;
  floorName: string;
}

export interface TTSSystemTestAlertInput extends TTSAlertBase {
  kind: "SYSTEM_TEST";
  spaceId: null;
  name: null;
  floorName: null;
  testMode: SystemTestMode;
  ttsText: typeof SYSTEM_TEST_TTS_TEXT;
}

export type TTSAlertInput = TTSIncidentAlertInput | TTSSystemTestAlertInput;

const PRIORITY: Record<TTSLevel, number> = { EMERGENCY: 0, DANGER: 1, CAUTION: 2 };
const AUDIO_LEVEL: Record<TTSLevel, AudioLevel> = {
  EMERGENCY: "emergency",
  DANGER: "danger",
  CAUTION: "caution",
};
const REANNOUNCE_MS = [30_000, 120_000, 300_000];
const MAX_SPOKEN_IDENTITIES = 1_000;

type Item = TTSAlertInput & {
  announces: number;
  nextAt: number;
};
interface Utterance {
  identity: string;
  firstAnnouncement: boolean;
  priority: number;
  seq: number;
  text: string;
}

export class TTSManager {
  private items = new Map<string, Item>();
  private queue: Utterance[] = [];
  private spokenIdentities = new Set<string>();
  private speakingIdentity: string | null = null;
  private enabled = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextSeq = 0;
  private playbackGeneration = 0;

  private ensureTimer() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1_000);
  }

  update(alerts: TTSAlertInput[], enabled: boolean) {
    this.ensureTimer();
    if (!enabled) {
      if (this.enabled) this.silenceAll();
      this.enabled = false;
      return;
    }
    this.enabled = true;

    const now = Date.now();
    const incoming = new Map(alerts.map((alert) => [alert.identity, alert]));

    for (const identity of [...this.items.keys()]) {
      if (incoming.has(identity)) continue;
      this.items.delete(identity);
      this.queue = this.queue.filter((utterance) => utterance.identity !== identity);
    }

    for (const alert of incoming.values()) {
      const current = this.items.get(alert.identity);
      if (!current) {
        if (!this.spokenIdentities.has(alert.identity)) {
          this.items.set(alert.identity, { ...alert, announces: 0, nextAt: now });
        }
      } else if (PRIORITY[alert.level] < PRIORITY[current.level]) {
        this.items.set(alert.identity, { ...alert, announces: 0, nextAt: now });
        // A stale queued (not yet drained) reannouncement utterance for this
        // identity would otherwise block tick() from re-enqueueing it at the
        // upgraded severity/text/first-announcement cohort.
        this.queue = this.queue.filter((utterance) => utterance.identity !== alert.identity);
      } else {
        Object.assign(current, alert);
      }
    }
  }

  /**
   * Retries active alerts from a real browser user gesture after autoplay
   * blocked speech. This intentionally drains synchronously so speak() stays
   * in the gesture's call stack.
   */
  retryPendingOnUserGesture() {
    if (!this.enabled) return;

    const now = Date.now();
    for (const item of this.items.values()) {
      if (item.identity !== this.speakingIdentity) item.nextAt = now;
    }
    this.tick();
  }

  private tick() {
    if (!this.enabled) return;
    const now = Date.now();
    const due = [...this.items.values()]
      .filter((item) => item.nextAt <= now)
      .sort((a, b) => PRIORITY[a.level] - PRIORITY[b.level]);

    for (const item of due) {
      const alreadyQueued = this.queue.some((utterance) => utterance.identity === item.identity);
      if (alreadyQueued || this.speakingIdentity === item.identity) continue;
      // Capture the cohort before incrementing: first announcements cannot be
      // starved by reannouncements from already-spoken active incidents.
      const firstAnnouncement = item.announces === 0;
      this.queue.push({
        identity: item.identity,
        firstAnnouncement,
        priority: PRIORITY[item.level],
        seq: this.nextSeq++,
        text: item.kind === "SYSTEM_TEST"
          ? item.ttsText
          : textFor(item.name, AUDIO_LEVEL[item.level]),
      });
      this.queue.sort((a, b) =>
        (a.firstAnnouncement === b.firstAnnouncement ? 0 : a.firstAnnouncement ? -1 : 1) ||
        a.priority - b.priority ||
        a.seq - b.seq
      );
      const delay = REANNOUNCE_MS[Math.min(item.announces, REANNOUNCE_MS.length - 1)];
      item.announces += 1;
      item.nextAt = now + delay;
    }
    this.drain();
  }

  private drain() {
    if (this.speakingIdentity || this.queue.length === 0 || !this.enabled) return;
    const next = this.queue.shift()!;
    const generation = this.playbackGeneration;
    this.speakingIdentity = next.identity;
    this.rememberSpoken(next.identity);
    playTTS(next.text)
      .then((result) => {
        setTTSFailure(result.ok ? null : result.reason);
      })
      .finally(() => {
        if (generation !== this.playbackGeneration) return;
        this.speakingIdentity = null;
        this.drain();
      });
  }

  private rememberSpoken(identity: string) {
    this.spokenIdentities.delete(identity);
    this.spokenIdentities.add(identity);
    while (this.spokenIdentities.size > MAX_SPOKEN_IDENTITIES) {
      const oldest = this.spokenIdentities.values().next().value as string | undefined;
      if (!oldest) break;
      this.spokenIdentities.delete(oldest);
    }
  }

  private silenceAll() {
    this.playbackGeneration += 1;
    cancelTTS();
    this.queue = [];
    this.items.clear();
    this.speakingIdentity = null;
  }
}

export const ttsManager = new TTSManager();

/** Scripted events must not acquire browser audio permission. */
export function retryPendingTTSFromTrustedInteraction(event: Pick<Event, "isTrusted">): boolean {
  if (!event.isTrusted) return false;
  ttsManager.retryPendingOnUserGesture();
  return true;
}

let failureReason: TTSFailureReason | null = null;
const failureListeners = new Set<(reason: TTSFailureReason | null) => void>();

function setTTSFailure(reason: TTSFailureReason | null): void {
  if (failureReason === reason) return;
  failureReason = reason;
  for (const listener of failureListeners) listener(reason);
}

export function getTTSFailureReason(): TTSFailureReason | null {
  return failureReason;
}

export function subscribeTTSFailure(
  listener: (reason: TTSFailureReason | null) => void,
): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

export function clearTTSFailure(): void {
  setTTSFailure(null);
}

export function __setTTSFailureForTest(reason: TTSFailureReason | null): void {
  setTTSFailure(reason);
}
