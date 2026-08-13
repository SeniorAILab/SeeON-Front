import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SoundToggle } from "./SoundToggle";
import {
  __setTTSFailureForTest,
  clearTTSFailure,
  getTTSFailureReason,
  retryPendingTTSFromTrustedInteraction,
  ttsManager,
} from "@/features/monitor/services/tts/ttsManager";
import { getTTSProvider } from "@/features/monitor/services/tts/ttsProvider";

describe("SoundToggle — 음성 실패 복구", () => {
  beforeEach(() => {
    clearTTSFailure();
    vi.restoreAllMocks();
  });

  it("정상 상태에서는 경고를 띄우지 않는다", () => {
    render(<SoundToggle enabled onToggle={() => {}} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("발화가 차단되어도 텍스트 경고를 띄우지 않는다", () => {
    __setTTSFailureForTest("blocked");

    render(<SoundToggle enabled onToggle={() => {}} />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("신뢰된 첫 사용자 상호작용은 대기 중인 발화를 재시도한다", () => {
    const retry = vi.spyOn(ttsManager, "retryPendingOnUserGesture");

    expect(retryPendingTTSFromTrustedInteraction({ isTrusted: true })).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("스크립트로 생성된 상호작용은 발화를 재시도하지 않는다", () => {
    const retry = vi.spyOn(ttsManager, "retryPendingOnUserGesture");

    expect(retryPendingTTSFromTrustedInteraction({ isTrusted: false })).toBe(false);
    expect(retry).not.toHaveBeenCalled();
  });

  it("미지원 브라우저와 엔진 오류는 각각 다른 문구를 낸다", async () => {
    __setTTSFailureForTest("unsupported");
    const { rerender } = render(<SoundToggle enabled onToggle={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "이 브라우저는 음성 안내를 지원하지 않습니다."
    );

    await act(async () => {
      __setTTSFailureForTest("engine");
    });
    rerender(<SoundToggle enabled onToggle={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "음성 안내를 재생하지 못했습니다. 소리를 다시 켜 주세요."
    );
  });

  it("토글을 누르면 실패 상태가 초기화되어 재시도 기회가 생긴다", async () => {
    __setTTSFailureForTest("engine");
    const onToggle = vi.fn();
    render(<SoundToggle enabled onToggle={onToggle} />);

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /음성 안내/ }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(getTTSFailureReason()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("소리가 꺼져 있으면 실패 안내를 띄우지 않는다", async () => {
    __setTTSFailureForTest("blocked");
    render(<SoundToggle enabled={false} onToggle={() => {}} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("manager가 실제 발화 실패를 관측하면 실패 상태가 기록된다", async () => {
    // provider가 autoplay 차단으로 거부하는 실제 경로를 재현한다.
    vi.spyOn(getTTSProvider(), "speak").mockResolvedValue({
      ok: false,
      reason: "blocked",
    });
    vi.useFakeTimers();

    render(<SoundToggle enabled onToggle={() => {}} />);

    await act(async () => {
      ttsManager.update(
        [
          {
            identity: "event-sound-failure",
            kind: "INCIDENT",
            spaceId: "sp_205",
            name: "205호",
            level: "DANGER",
            reason: "낙상 감지",
            floorName: "2F",
          },
        ],
        true
      );
      // tick()은 1초 인터벌이다.
      await vi.advanceTimersByTimeAsync(1_100);
    });

    expect(getTTSFailureReason()).toBe("blocked");

    vi.useRealTimers();
    ttsManager.update([], false);
  });
});
