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
const MAX_QUEUE_ITEMS = 200;
const MAX_SPOKEN_IDENTITIES = 1_000;

type Item = TTSAlertInput & {
  announces: number;
  nextAt: number;
};
interface Utterance {
  identity: string;
  priority: number;
  ordinal: number;
  text: string;
}

export class TTSManager {
  private items = new Map<string, Item>();
  private queue: Utterance[] = [];
  private spokenIdentities = new Set<string>();
  private speakingIdentity: string | null = null;
  private enabled = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextOrdinal = 0;
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
      } else {
        Object.assign(current, alert);
      }
    }
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
      this.queue.push({
        identity: item.identity,
        priority: PRIORITY[item.level],
        ordinal: this.nextOrdinal++,
        text: item.kind === "SYSTEM_TEST"
          ? item.ttsText
          : textFor(item.name, AUDIO_LEVEL[item.level]),
      });
      this.queue.sort((a, b) => a.priority - b.priority || a.ordinal - b.ordinal);
      if (this.queue.length > MAX_QUEUE_ITEMS) this.queue.length = MAX_QUEUE_ITEMS;
      if (!this.queue.some((utterance) => utterance.identity === item.identity)) continue;
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
