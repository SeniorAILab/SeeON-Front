import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AudioToggleButton } from "./AudioToggleButton";

describe("AudioToggleButton", () => {
  it.each([
    { enabled: true, label: "음성 안내 켜짐" },
    { enabled: false, label: "음성 안내 꺼짐" },
  ])("renders only the $label icon button", ({ enabled, label }) => {
    const onToggle = vi.fn();
    const { container } = render(
      <AudioToggleButton enabled={enabled} onToggle={onToggle} />,
    );

    const button = screen.getByRole("button", { name: label });
    expect(button.getAttribute("title")).toBe(label);
    expect(container.childElementCount).toBe(1);
    expect(container.firstElementChild).toBe(button);
    expect(button.textContent).toBe("");

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
