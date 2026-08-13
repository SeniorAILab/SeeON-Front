import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomActionPanel } from "./RoomActionPanel";
import type { DetectionEvent, Space, SpaceStatus } from "@/types";
import { formatDateTime } from "@/lib/format";

vi.mock("@/services/alertService", () => ({
  alertService: {
    resolve: vi.fn(async () => ({})),
    acknowledge: vi.fn(async () => ({})),
  },
}));

const spaces: Space[] = [
  { id: "b", facilityId: "fac", floorId: "2", name: "202호", type: "ROOM", capacity: 2, isActive: true, provisioningSource: "PRODUCT" },
  { id: "a", facilityId: "fac", floorId: "2", name: "201호", type: "ROOM", capacity: 2, isActive: true, provisioningSource: "PRODUCT" },
  { id: "c", facilityId: "fac", floorId: "3", name: "301호", type: "ROOM", capacity: 2, isActive: true, provisioningSource: "PRODUCT" },
];

function status(id: string, level: SpaceStatus["status"]): SpaceStatus {
  return {
    id: `alert-${id}`,
    spaceId: id,
    peopleCount: 1,
    movementLevel: "LOW",
    fallRiskLevel: level === "DANGER" ? "HIGH" : "LOW",
    status: level,
    aiSummary: "확인이 필요합니다.",
    lastDetectedAt: "2026-07-03T00:00:00.000Z",
    connection: "LIVE",
    lastSeenAt: "2026-08-03T11:59:30.000Z",
    alertStatus: "PENDING",
  };
}

function alert(overrides: Partial<DetectionEvent> = {}): DetectionEvent {
  return {
    id: "alert-a",
    facilityId: "fac",
    spaceId: "a",
    eventType: "FALL_RISK",
    riskLevel: "HIGH",
    message: "낙상 위험",
    aiSummary: "낙상 위험이 감지되었습니다.",
    detectedAt: "2026-07-03T00:00:00.000Z",
    alertStatus: "PENDING",
    ...overrides,
  };
}

beforeEach(async () => {
  const { alertService } = await import("@/services/alertService");
  vi.mocked(alertService.acknowledge).mockClear();
  vi.mocked(alertService.resolve).mockClear();
});

describe("RoomActionPanel", () => {
  it("pages alert groups by 20 rows and collapses back to five rows", () => {
    const alerts = Array.from({ length: 30 }, (_, index) =>
      alert({
        id: `fall-${index}`,
        aiSummary: `낙상 ${index}`,
        detectedAt: `2026-07-03T00:${String(index).padStart(2, "0")}:00.000Z`,
      }),
    );

    render(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={alerts} onClose={vi.fn()} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "더 보기 (25)" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "더 보기 (25)" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(25);
    expect(screen.getByRole("button", { name: "더 보기 (5)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "접기" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "더 보기 (5)" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(30);
    expect(screen.queryByRole("button", { name: /더 보기/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "접기" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "더 보기 (25)" })).toBeTruthy();
  });

  it("renders each alert's formatted detected time", () => {
    const detectedAt = "2026-07-03T00:00:00.000Z";
    render(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={[alert({ detectedAt })]} onClose={vi.fn()} />);

    expect(screen.getByText(formatDateTime(detectedAt))).toBeTruthy();
  });

  it("offers 확인 with no text input anywhere, and never renders 해결 완료", () => {
    render(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={[alert()]} onClose={vi.fn()} />);

    // 메모 입력창은 없다 - 확인은 텍스트 없이 동작한다.
    expect(screen.queryByRole("textbox")).toBeNull();
    // 회귀 가드: 예전 2단계 흐름의 해결 완료 버튼이 되살아나지 않는다.
    expect(screen.queryByRole("button", { name: "해결 완료" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "확인" }).length).toBeGreaterThan(0);
  });

  it("renders as a modal dialog and closes from Escape, backdrop, and close button", () => {
    const onClose = vi.fn();
    const { rerender } = render(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={[alert()]} onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "201호" }).getAttribute("aria-modal")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={[alert()]} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "모달 닫기" }));
    expect(onClose).toHaveBeenCalledTimes(2);

    rerender(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={[alert()]} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "201호" }).parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("traps focus in the modal and restores it to the opener when closed", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    render(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={[alert()]} onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "201호" });
    const closeButton = screen.getByRole("button", { name: "모달 닫기" });
    // 알림이 하나뿐이므로 푸터의 주 확인 버튼이 마지막 탭 정지점이다.
    const footerConfirmButton = screen.getAllByRole("button", { name: "확인" }).at(-1)!;
    expect(document.activeElement).toBe(dialog);

    footerConfirmButton.focus();
    fireEvent.keyDown(footerConfirmButton, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(footerConfirmButton);

    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
  it("restores the original opener after rerendering with a new close handler in StrictMode", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const initialOnClose = vi.fn();
    const latestOnClose = vi.fn();
    const panel = (
      <StrictMode>
        <RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={[alert()]} onClose={initialOnClose} />
      </StrictMode>
    );
    const { rerender } = render(panel);

    const closeButton = screen.getByRole("button", { name: "모달 닫기" });
    closeButton.focus();
    rerender(
      <StrictMode>
        <RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={[alert()]} onClose={latestOnClose} />
      </StrictMode>,
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(initialOnClose).not.toHaveBeenCalled();
    expect(latestOnClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
  it("uses the wide modal token and does not render gray disabled tokens", () => {
    const { container } = render(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={[alert()]} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "201호" }).className).toContain("max-w-4xl");
    const classNames = [...container.querySelectorAll("*")].map((element) => element.className.toString());
    expect(classNames.some((className) => /gray-300/.test(className))).toBe(false);
  });

  it("does not resolve when there are no alerts to confirm", async () => {
    const { alertService } = await import("@/services/alertService");
    render(<RoomActionPanel space={spaces[1]} status={{ ...status("a", "DANGER"), id: "status-a" }} alerts={[]} onClose={vi.fn()} />);

    const confirmButton = screen.getByRole("button", { name: "확인" }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    fireEvent.click(confirmButton);
    expect(alertService.resolve).not.toHaveBeenCalled();
    expect(alertService.acknowledge).not.toHaveBeenCalled();
  });

  it("renders one chronological feed sorted newest-first across mixed event types", () => {
    const alerts = [
      alert({ id: "fall-old", eventType: "FALL_RISK", detectedAt: "2026-07-03T00:01:00.000Z" }),
      alert({ id: "bed-1", eventType: "BED_EXIT", detectedAt: "2026-07-03T00:03:00.000Z" }),
      alert({ id: "wander-1", eventType: "WANDERING", detectedAt: "2026-07-03T00:02:00.000Z" }),
      alert({ id: "wander-new", eventType: "WANDERING", detectedAt: "2026-07-03T00:04:00.000Z" }),
    ];

    const { container } = render(
      <RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={alerts} onClose={vi.fn()} />,
    );

    const rows = [...container.querySelectorAll("[data-event-type]")];
    expect(rows.map((row) => row.getAttribute("data-event-type"))).toEqual([
      "WANDERING",
      "BED_EXIT",
      "WANDERING",
      "FALL_RISK",
    ]);
    expect(rows.map((row) => row.closest("li")?.getAttribute("data-event-type") ?? row.getAttribute("data-event-type"))).toEqual([
      "WANDERING",
      "BED_EXIT",
      "WANDERING",
      "FALL_RISK",
    ]);
    // 실제 정렬 순서: fall-new(00:04) > bed-1(00:03) > wander-1(00:02) > fall-old(00:01)
    const idsInOrder = rows.map((row) => row.closest("li")?.textContent ?? "");
    expect(idsInOrder[0]).toContain(formatDateTime("2026-07-03T00:04:00.000Z"));
    expect(idsInOrder[3]).toContain(formatDateTime("2026-07-03T00:01:00.000Z"));
  });

  it("shows the Korean title for a FALL_RISK row", () => {
    render(
      <RoomActionPanel
        space={spaces[1]}
        status={status("a", "DANGER")}
        alerts={[alert({ id: "fall-1", eventType: "FALL_RISK" })]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("낙상 위험")).toBeTruthy();
  });

  it("resolves exactly the clicked row's alert id, and never calls acknowledge", async () => {
    const alerts = [
      alert({ id: "fall-1", eventType: "FALL_RISK", detectedAt: "2026-07-03T00:02:00.000Z" }),
      alert({ id: "bed-1", eventType: "BED_EXIT", detectedAt: "2026-07-03T00:01:00.000Z" }),
    ];
    const { alertService } = await import("@/services/alertService");
    render(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={alerts} onClose={vi.fn()} />);

    // 행 버튼은 피드 순서(최신순)로 나열되고, 푸터 확인 버튼이 마지막에 온다. fall-1이 더 최신이므로 첫 번째 행이다.
    fireEvent.click(screen.getAllByRole("button", { name: "확인" })[0]);

    await waitFor(() => expect(alertService.resolve).toHaveBeenCalledWith("fall-1"));
    expect(alertService.resolve).not.toHaveBeenCalledWith("bed-1");
    expect(alertService.resolve).toHaveBeenCalledTimes(1);
    expect(alertService.acknowledge).not.toHaveBeenCalled();
  });

  it("shows the plain alert count in the header subtitle (no 미확인 wording)", () => {
    const alerts = [
      alert({ id: "fall-1", eventType: "FALL_RISK", alertStatus: "PENDING" }),
      alert({ id: "bed-1", eventType: "BED_EXIT", alertStatus: "PENDING" }),
      alert({ id: "wander-1", eventType: "WANDERING", alertStatus: "SENT" }),
    ];

    render(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={alerts} onClose={vi.fn()} />);

    expect(screen.getByText("3건")).toBeTruthy();
    expect(screen.queryByText(/미확인/)).toBeNull();
  });

  it('labels the footer button 모두 확인 when there is more than one alert, 확인 when there is exactly one', () => {
    const { rerender } = render(
      <RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={[alert({ id: "only-1" })]} onClose={vi.fn()} />,
    );
    // 알림이 하나면 행 버튼과 푸터 버튼 둘 다 "확인"이다.
    expect(screen.getAllByRole("button", { name: "확인" }).length).toBe(2);
    expect(screen.queryByRole("button", { name: "모두 확인" })).toBeNull();

    rerender(
      <RoomActionPanel
        space={spaces[1]}
        status={status("a", "DANGER")}
        alerts={[alert({ id: "one" }), alert({ id: "two" })]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "모두 확인" })).toBeTruthy();
  });

  it("footer 모두 확인 resolves every alert id currently in the feed", async () => {
    const alerts = [
      alert({ id: "fall-1", eventType: "FALL_RISK", detectedAt: "2026-07-03T00:02:00.000Z" }),
      alert({ id: "bed-1", eventType: "BED_EXIT", detectedAt: "2026-07-03T00:01:00.000Z" }),
    ];
    const { alertService } = await import("@/services/alertService");
    const onResolved = vi.fn();
    render(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={alerts} onClose={vi.fn()} onResolved={onResolved} />);

    fireEvent.click(screen.getByRole("button", { name: "모두 확인" }));

    await waitFor(() => expect(alertService.resolve).toHaveBeenCalledWith("fall-1"));
    expect(alertService.resolve).toHaveBeenCalledWith("bed-1");
    expect(alertService.resolve).toHaveBeenCalledTimes(2);
    expect(alertService.acknowledge).not.toHaveBeenCalled();
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
  });

  it("never renders a memo history section", () => {
    render(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={[alert()]} onClose={vi.fn()} />);

    expect(screen.queryByText("메모 히스토리")).toBeNull();
    expect(screen.queryByText(/저장된 메모/)).toBeNull();
  });

  it("renders a safe Korean title for an unregistered OTHER event type and never crashes on an unparseable detectedAt", () => {
    const alerts = [
      alert({ id: "other-1", eventType: "OTHER", detectedAt: "not-a-date" }),
      alert({ id: "fall-1", eventType: "FALL_RISK", detectedAt: "2026-07-03T00:01:00.000Z" }),
    ];

    const { container } = render(
      <RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={alerts} onClose={vi.fn()} />,
    );

    expect(container.querySelectorAll("[data-event-type]")).toHaveLength(2);
    // OTHER 로우는 안전한 한글 제목으로 대체된다 - raw eventType 코드가 화면에 노출되지 않는다.
    expect(screen.queryByText("OTHER")).toBeNull();
  });
});

describe("확인 실패를 침묵으로 넘기지 않는다", () => {
  async function svc() {
    const { alertService } = await import("@/services/alertService");
    return alertService;
  }

  function renderPanel(onResolved = vi.fn()) {
    render(
      <RoomActionPanel
        space={spaces[1]}
        status={status("a", "DANGER")}
        alerts={[alert({ id: "event-1" })]}
        onClose={vi.fn()}
        onResolved={onResolved}
      />,
    );
    return onResolved;
  }

  it("서버가 400으로 거부하면 사유를 화면에 띄운다", async () => {
    // catch가 없으면 요양보호사는 눌렀는데 아무 일도 안 일어나는 것을 보고
    // 처리됐다고 믿는다 — 어떤 이유로든 확인 요청이 실패하면 반드시 화면에 사유를 보여준다.
    const alertService = await svc();
    const { ApiError } = await import("@/services/apiClient");
    vi.mocked(alertService.resolve).mockRejectedValueOnce(
      // 실제 Nest 응답 형태(JSON 본문)를 그대로 흉내낸다.
      new ApiError(
        400,
        JSON.stringify({
          statusCode: 400,
          message: "요청을 처리할 수 없습니다.",
        }),
      ),
    );

    renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: "확인" }).at(-1)!);

    const nodes = await screen.findAllByRole("alert");
    expect(
      nodes.some((n) => (n.textContent ?? "").includes("요청을 처리할 수 없습니다")),
    ).toBe(true);
  });

  it("네트워크 오류도 문구로 알린다", async () => {
    const alertService = await svc();
    vi.mocked(alertService.resolve).mockRejectedValueOnce(new Error("network down"));

    renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: "확인" }).at(-1)!);

    const nodes = await screen.findAllByRole("alert");
    expect(
      nodes.some((n) => (n.textContent ?? "").includes("확인 처리를 하지 못했습니다")),
    ).toBe(true);
  });

  it("성공하면 오류 문구가 남지 않는다", async () => {
    const alertService = await svc();
    vi.mocked(alertService.resolve).mockResolvedValueOnce({} as never);

    const onResolved = renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: "확인" }).at(-1)!);

    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(screen.queryByText(/확인 처리를 하지 못했습니다/)).toBeNull();
  });

  it("실패 후 다시 시도하면 busy 상태에서 두 번째 클릭이 중복 호출을 만들지 않는다", async () => {
    const alertService = await svc();
    let resolveCount = 0;
    vi.mocked(alertService.resolve).mockImplementation(() => {
      resolveCount += 1;
      return new Promise((resolve) => setTimeout(() => resolve({} as never), 20));
    });

    renderPanel();
    const button = screen.getAllByRole("button", { name: "확인" }).at(-1)!;
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(resolveCount).toBe(1));
  });
});

describe("한 번의 확인이 곧 처리 완료다 (I4)", () => {
  async function svc() {
    const { alertService } = await import("@/services/alertService");
    return alertService;
  }

  function renderPanel() {
    render(
      <RoomActionPanel
        space={spaces[1]}
        status={status("a", "DANGER")}
        alerts={[alert({ id: "event-1" })]}
        onClose={vi.fn()}
        onResolved={vi.fn()}
      />,
    );
  }

  it("확인은 메모 없이도 눌리고 RESOLVE만 호출한다 - ACK는 절대 호출되지 않는다", async () => {
    const alertService = await svc();
    renderPanel();

    fireEvent.click(screen.getAllByRole("button", { name: "확인" })[0]);

    await waitFor(() => expect(alertService.resolve).toHaveBeenCalledWith("event-1"));
    expect(alertService.acknowledge).not.toHaveBeenCalled();
  });

  it("패널에 보이는 모든 알림은 정의상 활성 상태이므로 확인 버튼은 항상 활성화되어 있다", () => {
    render(
      <RoomActionPanel
        space={spaces[1]}
        status={status("a", "DANGER")}
        alerts={[alert({ id: "event-1" })]}
        onClose={vi.fn()}
      />,
    );

    for (const button of screen.getAllByRole("button", { name: "확인" }) as HTMLButtonElement[]) {
      expect(button.disabled).toBe(false);
    }
  });
});
