import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  clearTTSFailure,
  getTTSFailureReason,
  retryPendingTTSFromTrustedInteraction,
  subscribeTTSFailure,
} from "@/features/monitor/services/tts/ttsManager";
import type { TTSFailureReason } from "@/features/monitor/services/tts/ttsProvider";

/**
 * autoplay 차단은 다음 실제 사용자 상호작용에서 즉시 재시도한다.
 * 지원 불가와 엔진 오류만 화면에 남긴다.
 */
const FAILURE_MESSAGE: Record<Exclude<TTSFailureReason, "blocked">, string> = {
  unsupported: "이 브라우저는 음성 안내를 지원하지 않습니다.",
  engine: "음성 안내를 재생하지 못했습니다. 소리를 다시 켜 주세요.",
};

/** 음성(TTS) 안내 켜기/끄기 — 켜면 주의/위험/응급을 음성으로 안내 */
export function SoundToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  const [failure, setFailure] = useState<TTSFailureReason | null>(() =>
    getTTSFailureReason()
  );
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeTTSFailure(setFailure), []);

  useEffect(() => {
    if (!enabled || failure !== "blocked") return;

    let removed = false;
    const removeListeners = () => {
      if (removed) return;
      removed = true;
      document.removeEventListener("pointerdown", onInteraction, true);
      document.removeEventListener("keydown", onInteraction, true);
    };
    const onInteraction = (event: Event) => {
      if (event.target instanceof Node && toggleRef.current?.contains(event.target)) return;
      if (retryPendingTTSFromTrustedInteraction(event)) removeListeners();
    };

    document.addEventListener("pointerdown", onInteraction, true);
    document.addEventListener("keydown", onInteraction, true);
    return removeListeners;
  }, [enabled, failure]);

  function handleToggle() {
    // 명시적 음성 설정은 자동 재시도와 별개로 기존 동작을 유지한다.
    clearTTSFailure();
    onToggle();
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        ref={toggleRef}
        onClick={handleToggle}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-base font-semibold transition-colors",
          enabled
            ? "border-brand/40 bg-brand-soft text-brand"
            : "border-border text-ink-soft hover:bg-surface2"
        )}
        title="음성 안내(TTS)"
      >
        {enabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
        음성 안내 {enabled ? "켜짐" : "꺼짐"}
      </button>
      {enabled && failure !== null && failure !== "blocked" && (
        <p role="alert" className="text-sm font-medium text-status-danger">
          {FAILURE_MESSAGE[failure]}
        </p>
      )}
    </div>
  );
}
