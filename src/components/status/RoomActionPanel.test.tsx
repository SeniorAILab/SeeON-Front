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

  it("explains the 확인 → 해결 완료 flow without any text input", () => {
    render(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={[alert()]} onClose={vi.fn()} />);

    expect(screen.getByText(/알림을 받았다고 알리세요/)).toBeTruthy();
    // 메모 입력창은 없다 - 확인/해결 완료는 텍스트 없이 동작한다.
    expect(screen.queryByRole("textbox")).toBeNull();
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
    const resolveButton = screen.getByRole("button", { name: "해결 완료" });
    expect(document.activeElement).toBe(dialog);

    resolveButton.focus();
    fireEvent.keyDown(resolveButton, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(resolveButton);

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

  it("does not resolve a synthetic status id when no real alert exists", async () => {
    const { alertService } = await import("@/services/alertService");
    render(<RoomActionPanel space={spaces[1]} status={{ ...status("a", "DANGER"), id: "status-a" }} alerts={[]} onClose={vi.fn()} />);

    const resolveButton = screen.getByRole("button", { name: "확인" }) as HTMLButtonElement;
    expect(resolveButton.disabled).toBe(true);
    fireEvent.click(resolveButton);
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

  it("acknowledges exactly the clicked row's alert id", async () => {
    const alerts = [
      alert({ id: "fall-1", eventType: "FALL_RISK", detectedAt: "2026-07-03T00:02:00.000Z" }),
      alert({ id: "bed-1", eventType: "BED_EXIT", detectedAt: "2026-07-03T00:01:00.000Z" }),
    ];
    const { alertService } = await import("@/services/alertService");
    render(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={alerts} onClose={vi.fn()} />);

    // 행 버튼은 피드 순서(최신순)로 나열되고, 푸터 확인 버튼이 마지막에 온다. fall-1이 더 최신이므로 첫 번째 행다.
    fireEvent.click(screen.getAllByRole("button", { name: "확인" })[0]);

    await waitFor(() => expect(alertService.acknowledge).toHaveBeenCalledWith("fall-1"));
    expect(alertService.acknowledge).not.toHaveBeenCalledWith("bed-1");
    expect(alertService.acknowledge).toHaveBeenCalledTimes(1);
  });

  it("disables the row 확인 button once that alert is ACKNOWLEDGED", () => {
    render(
      <RoomActionPanel
        space={spaces[1]}
        status={status("a", "DANGER")}
        alerts={[alert({ id: "fall-1", eventType: "FALL_RISK", alertStatus: "ACKNOWLEDGED" })]}
        onClose={vi.fn()}
      />,
    );

    const rowAckButtons = screen.getAllByRole("button", { name: "확인" });
    // row-level button is the last one after the header/footer 확인 button.
    const rowAckButton = rowAckButtons[rowAckButtons.length - 1] as HTMLButtonElement;
    expect(rowAckButton.disabled).toBe(true);
  });

  it("shows the unacknowledged count in the header subtitle", () => {
    const alerts = [
      alert({ id: "fall-1", eventType: "FALL_RISK", alertStatus: "PENDING" }),
      alert({ id: "bed-1", eventType: "BED_EXIT", alertStatus: "ACKNOWLEDGED" }),
      alert({ id: "wander-1", eventType: "WANDERING", alertStatus: "SENT" }),
    ];

    render(<RoomActionPanel space={spaces[1]} status={status("a", "DANGER")} alerts={alerts} onClose={vi.fn()} />);

    expect(screen.getByText("미확인 2건")).toBeTruthy();
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

describe("해결 완료 실패를 침묵으로 넘기지 않는다", () => {
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
    // 처리됐다고 믿는다 — 이유가 무엇이든(조치 기록 요구는 더 이상 없지만,
    // 다른 서버 거부는 여전히 있을 수 있다) 반드시 화면에 사유를 보여준다.
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
    fireEvent.click(screen.getByRole("button", { name: "해결 완료" }));

    const nodes = await screen.findAllByRole("alert");
    expect(
      nodes.some((n) => (n.textContent ?? "").includes("요청을 처리할 수 없습니다")),
    ).toBe(true);
  });

  it("네트워크 오류도 문구로 알린다", async () => {
    const alertService = await svc();
    vi.mocked(alertService.resolve).mockRejectedValueOnce(new Error("network down"));

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "해결 완료" }));

    const nodes = await screen.findAllByRole("alert");
    expect(
      nodes.some((n) => (n.textContent ?? "").includes("해결 완료로 바꾸지 못했습니다")),
    ).toBe(true);
  });

  it("성공하면 오류 문구가 남지 않는다", async () => {
    const alertService = await svc();
    vi.mocked(alertService.resolve).mockResolvedValueOnce({} as never);

    const onResolved = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "해결 완료" }));

    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(screen.queryByText(/해결 완료로 바꾸지 못했습니다/)).toBeNull();
  });
});

describe("확인(ACK)과 해결 완료(RESOLVE)는 다른 동작이다 (I4)", () => {
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

  it("확인은 메모 없이도 눌리고 ACK만 호출한다", async () => {
    // TV 앞에서 타이핑하기 전에 "내가 간다"를 먼저 알려야 한다.
    const alertService = await svc();
    vi.mocked(alertService.resolve).mockClear();
    vi.mocked(alertService.acknowledge).mockClear();
    renderPanel();

    fireEvent.click(screen.getAllByRole("button", { name: "확인" })[0]);

    await waitFor(() => expect(alertService.acknowledge).toHaveBeenCalledWith("event-1"));
    expect(alertService.resolve).not.toHaveBeenCalled();
  });

  it("해결 완료는 RESOLVE를 호출한다", async () => {
    const alertService = await svc();
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "해결 완료" }));

    await waitFor(() => expect(alertService.resolve).toHaveBeenCalledWith("event-1"));
  });

  it("이미 확인된 알림만 있으면 확인 버튼이 비활성이다", () => {
    render(
      <RoomActionPanel
        space={spaces[1]}
        status={status("a", "DANGER")}
        alerts={[alert({ id: "event-1", alertStatus: "ACKNOWLEDGED" })]}
        onClose={vi.fn()}
      />,
    );

    for (const button of screen.getAllByRole("button", { name: "확인" }) as HTMLButtonElement[]) {
      expect(button.disabled).toBe(true);
    }
  });

  it("확인 후에도 패널이 열려 있어 해결 완료로 이어갈 수 있다", async () => {
    // 확인 → 방문 → 해결 완료가 한 흐름이다. 확인에서 패널이 닫히면
    // 요양보호사가 다시 찾아 들어와야 한다.
    const alertService = await svc();
    vi.mocked(alertService.acknowledge).mockClear();
    renderPanel();

    fireEvent.click(screen.getAllByRole("button", { name: "확인" })[0]);
    await waitFor(() => expect(alertService.acknowledge).toHaveBeenCalled());

    // 패널이 닫히지 않고, 해결 완료로 바로 이어갈 수 있다.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "해결 완료" })).toBeTruthy();
  });
});

describe("ack-then-resolve-sequence — 확인 후 메모 없이도 해결할 수 있다", () => {
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

  it("확인은 ACK만 호출하고 해결로 넘어가지 않는다", async () => {
    const alertService = await svc();
    vi.mocked(alertService.acknowledge).mockClear();
    vi.mocked(alertService.resolve).mockClear();
    renderPanel();

    fireEvent.click(screen.getAllByRole("button", { name: "확인" })[0]);

    await waitFor(() => expect(alertService.acknowledge).toHaveBeenCalledWith("event-1"));
    expect(alertService.resolve).not.toHaveBeenCalled();
  });

  it("메모를 하나도 남기지 않고도 해결 완료를 누르면 곧바로 성공한다", async () => {
    // 화면에는 텍스트 입력이 없다 — 메모 없이 해결을 누르면 서버 거부 없이 끝난다.
    const alertService = await svc();
    const onResolved = vi.fn();
    vi.mocked(alertService.resolve).mockResolvedValueOnce({} as never);
    render(
      <RoomActionPanel
        space={spaces[1]}
        status={status("a", "DANGER")}
        alerts={[alert({ id: "event-1" })]}
        onClose={vi.fn()}
        onResolved={onResolved}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "해결 완료" }));

    await waitFor(() => expect(alertService.resolve).toHaveBeenCalledWith("event-1"));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("확인 후에도 해결 완료 버튼이 남아 순서를 이어갈 수 있다", async () => {
    const alertService = await svc();
    vi.mocked(alertService.acknowledge).mockClear();
    renderPanel();

    fireEvent.click(screen.getAllByRole("button", { name: "확인" })[0]);
    await waitFor(() => expect(alertService.acknowledge).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "해결 완료" })).toBeTruthy();
  });
});
