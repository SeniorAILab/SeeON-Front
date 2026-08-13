import { Volume2, VolumeX } from "lucide-react";

export function AudioToggleButton({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  const label = enabled ? "음성 안내 켜짐" : "음성 안내 꺼짐";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className="rounded-xl p-2.5 text-ink-soft hover:bg-surface2"
    >
      {enabled ? <Volume2 className="h-6 w-6" /> : <VolumeX className="h-6 w-6" />}
    </button>
  );
}
