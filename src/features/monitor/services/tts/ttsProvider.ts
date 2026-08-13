// =============================================================
// TTS Provider 인터페이스 (교체 가능 설계)
//   MVP: 브라우저 SpeechSynthesis
//   상용화: Naver CLOVA Voice / Google Cloud TTS 로 교체
//   → 같은 인터페이스만 구현하면 상위 로직(큐/스케줄) 변경 없음.
// =============================================================

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
}

/** 발화 실패 사유. */
export type TTSFailureReason =
  /** 브라우저가 음성합성을 지원하지 않음 */
  | "unsupported"
  /** autoplay 정책 차단 */
  | "blocked"
  /** 음성 엔진 오류 */
  | "engine";

export type TTSSpeakResult = { ok: true } | { ok: false; reason: TTSFailureReason };

export interface TTSProvider {
  readonly name: string;
  isSupported(): boolean;
  /** 발화 결과를 보고한다. 실패를 성공처럼 삼키지 않는다. */
  speak(text: string, opts?: SpeakOptions): Promise<TTSSpeakResult>;
  cancel(): void;
}

/** 브라우저 SpeechSynthesis 구현. */
export class BrowserTTSProvider implements TTSProvider {
  readonly name = "browser-speech-synthesis";
  private voice: SpeechSynthesisVoice | null = null;

  constructor() {
    if (this.isSupported()) {
      this.loadVoice();
      window.speechSynthesis.addEventListener?.("voiceschanged", () => this.loadVoice());
    }
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  private loadVoice() {
    if (this.voice) return;
    const voices = window.speechSynthesis
      .getVoices()
      .filter((voice) => voice.lang?.toLowerCase().startsWith("ko"));
    if (voices.length === 0) return;
    this.voice = [...voices].sort(compareVoices)[0];
  }

  speak(text: string, opts: SpeakOptions = {}): Promise<TTSSpeakResult> {
    if (!this.isSupported()) {
      return Promise.resolve({ ok: false, reason: "unsupported" });
    }
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ko-KR";
      if (this.voice) u.voice = this.voice;
      u.rate = opts.rate ?? 0.96; // 차분하게
      u.pitch = opts.pitch ?? 1.0;
      u.volume = opts.volume ?? 1.0;
      u.onend = () => resolve({ ok: true });
      u.onerror = (event) =>
        resolve({
          ok: false,
          reason: event.error === "not-allowed" ? "blocked" : "engine",
        });
      window.speechSynthesis.speak(u);
    });
  }

  cancel() {
    if (this.isSupported()) window.speechSynthesis.cancel();
  }
}

function compareVoices(a: SpeechSynthesisVoice, b: SpeechSynthesisVoice): number {
  if (a.default !== b.default) return a.default ? -1 : 1;
  if (a.localService !== b.localService) return a.localService ? -1 : 1;
  const uriOrder = compareCaseFolded(a.voiceURI, b.voiceURI);
  if (uriOrder !== 0) return uriOrder;
  return compareCaseFolded(a.name, b.name);
}

function compareCaseFolded(a: string, b: string): number {
  const foldedA = a.toLowerCase();
  const foldedB = b.toLowerCase();
  return foldedA < foldedB ? -1 : foldedA > foldedB ? 1 : 0;
}

let provider: TTSProvider | null = null;
export function getTTSProvider(): TTSProvider {
  if (!provider) provider = new BrowserTTSProvider();
  return provider;
}
