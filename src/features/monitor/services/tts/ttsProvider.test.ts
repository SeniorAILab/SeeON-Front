import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserTTSProvider } from "./ttsProvider";

type TestUtterance = {
  text: string;
  lang: string;
  voice: SpeechSynthesisVoice | null;
  rate: number;
  pitch: number;
  volume: number;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

const voiceA = voice({
  lang: "ko-KR",
  name: "A",
  voiceURI: "ko-a",
  default: false,
  localService: false,
});
const voiceB = voice({
  lang: "ko-KR",
  name: "B",
  voiceURI: "ko-b",
  default: true,
  localService: false,
});
const nonKoreanVoice = voice({
  lang: "en-US",
  name: "English",
  voiceURI: "en-a",
  default: true,
  localService: true,
});

let voices: SpeechSynthesisVoice[];
let voicesChanged: (() => void) | undefined;
let spoken: TestUtterance[];

describe("BrowserTTSProvider deterministic Korean voice pinning", () => {
  beforeEach(() => {
    voices = [];
    voicesChanged = undefined;
    spoken = [];
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        text: string;
        lang = "";
        voice: SpeechSynthesisVoice | null = null;
        rate = 1;
        pitch = 1;
        volume = 1;
        onend: (() => void) | null = null;
        onerror: ((event: { error: string }) => void) | null = null;

        constructor(text: string) {
          this.text = text;
        }
      },
    );
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: vi.fn(() => voices),
        addEventListener: vi.fn((event: string, listener: () => void) => {
          if (event === "voiceschanged") voicesChanged = listener;
        }),
        speak: vi.fn((utterance: TestUtterance) => {
          spoken.push(utterance);
          utterance.onend?.();
        }),
        cancel: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, "speechSynthesis");
  });

  it("speaks immediately in ko-KR without an explicit voice while Korean voices are empty", async () => {
    voices = [nonKoreanVoice];
    const provider = new BrowserTTSProvider();

    await expect(provider.speak("즉시 안내")).resolves.toEqual({ ok: true });

    expect(spoken).toHaveLength(1);
    expect(spoken[0].lang).toBe("ko-KR");
    expect(spoken[0].voice).toBeNull();
  });

  it.each([
    { enumeratedVoices: [voiceA, voiceB, nonKoreanVoice] },
    { enumeratedVoices: [nonKoreanVoice, voiceB, voiceA] },
  ])("pins ko-b regardless of enumeration order", async ({ enumeratedVoices }) => {
    const provider = new BrowserTTSProvider();
    voices = enumeratedVoices;
    voicesChanged?.();

    await provider.speak("고정 음성");

    expect(spoken.at(-1)?.voice?.voiceURI).toBe("ko-b");
  });

  it.each([
    {
      candidates: [
        voice({ lang: "ko-KR", name: "Remote", voiceURI: "ko-a", default: false, localService: false }),
        voice({ lang: "ko-KR", name: "Default", voiceURI: "ko-z", default: true, localService: false }),
        voice({ lang: "ko-KR", name: "Local", voiceURI: "ko-y", default: false, localService: true }),
      ],
      expected: "Default",
    },
    {
      candidates: [
        voice({ lang: "ko-KR", name: "Remote", voiceURI: "ko-a", default: false, localService: false }),
        voice({ lang: "ko-KR", name: "Local", voiceURI: "ko-z", default: false, localService: true }),
      ],
      expected: "Local",
    },
    {
      candidates: [
        voice({ lang: "ko-KR", name: "URI B", voiceURI: "ko-b", default: false, localService: true }),
        voice({ lang: "ko-KR", name: "URI A", voiceURI: "ko-a", default: false, localService: true }),
      ],
      expected: "URI A",
    },
    {
      candidates: [
        voice({ lang: "ko-KR", name: "Zulu", voiceURI: "ko-same", default: false, localService: true }),
        voice({ lang: "ko-KR", name: "Alpha", voiceURI: "ko-same", default: false, localService: true }),
      ],
      expected: "Alpha",
    },
  ])("orders Korean voices by default, locality, URI, then name", async ({ candidates, expected }) => {
    voices = candidates;
    const provider = new BrowserTTSProvider();

    await provider.speak("우선순위");

    expect(spoken.at(-1)?.voice?.name).toBe(expected);
  });

  it("retains the first Korean winner across later voice changes and utterances", async () => {
    const provider = new BrowserTTSProvider();
    voices = [voiceA, voiceB];
    voicesChanged?.();
    const laterDefault = voice({
      lang: "ko-KR",
      name: "Later",
      voiceURI: "ko-later",
      default: true,
      localService: true,
    });
    voices = [laterDefault];
    voicesChanged?.();

    await provider.speak("첫 번째");
    await provider.speak("두 번째");

    expect(spoken.map((utterance) => utterance.voice)).toEqual([voiceB, voiceB]);
  });

  it("returns unsupported when browser synthesis is unavailable", async () => {
    Reflect.deleteProperty(window, "speechSynthesis");
    const provider = new BrowserTTSProvider();

    await expect(provider.speak("안내")).resolves.toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});

function voice(input: {
  lang: string;
  name: string;
  voiceURI: string;
  default: boolean;
  localService: boolean;
}): SpeechSynthesisVoice {
  return input as SpeechSynthesisVoice;
}
