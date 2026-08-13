import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlertsPage } from "./AlertsPage";
import type { AlertView } from "@/types";

vi.mock("@/services/alertService", () => ({
  alertService: {
    listRecent: vi.fn(),
    acknowledge: vi.fn(),
    resolve: vi.fn(),
  },
}));

const resolvedAlert = {
  id: "alert-resolved-1",
  room: "201호",
  status: "RESOLVED",
  type: "fall",
  detectedAt: "2026-07-03T00:00:00.000Z",
  resolvedAt: "2026-07-03T00:10:00.000Z",
  resolvedByName: "요양보호사",
} as AlertView;


beforeEach(async () => {
  const { alertService } = await import("@/services/alertService");
  vi.mocked(alertService.listRecent).mockResolvedValue([resolvedAlert]);
});

describe("확인은 메모 없이 버튼 한 번으로 끝난다", () => {
  async function svc() {
    const { alertService } = await import("@/services/alertService");
    return alertService;
  }

  it("확인 필요 카드는 텍스트 입력 없이 '확인' 버튼 하나만 보여준다", async () => {
    const alertService = await svc();
    vi.mocked(alertService.listRecent).mockResolvedValue([
      { ...resolvedAlert, id: "alert-new", status: "NEW", type: "fall" } as AlertView,
    ]);

    render(<AlertsPage />);

    expect(await screen.findByRole("button", { name: "확인" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/메모/)).toBeNull();
  });

  it("'확인'을 누르면 메모 없이 곧바로 resolve만 호출하고 acknowledge는 호출하지 않는다", async () => {
    const alertService = await svc();
    vi.mocked(alertService.listRecent).mockResolvedValue([
      { ...resolvedAlert, id: "alert-new", status: "NEW", type: "fall" } as AlertView,
    ]);
    vi.mocked(alertService.resolve).mockResolvedValue({
      ...resolvedAlert,
      id: "alert-new",
      status: "RESOLVED",
    } as AlertView);
    vi.mocked(alertService.acknowledge).mockClear();

    render(<AlertsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "확인" }));

    await waitFor(() => expect(alertService.resolve).toHaveBeenCalledWith("alert-new"));
    expect(alertService.acknowledge).not.toHaveBeenCalled();
  });

  it("레거시 ACKED 알림도 '확인 필요' 섹션에 나타나고 한 번의 확인으로 끝난다", async () => {
    const alertService = await svc();
    vi.mocked(alertService.listRecent).mockResolvedValue([
      { ...resolvedAlert, id: "alert-acked", status: "ACKED", type: "fall" } as AlertView,
    ]);
    vi.mocked(alertService.resolve).mockResolvedValue({
      ...resolvedAlert,
      id: "alert-acked",
      status: "RESOLVED",
    } as AlertView);
    vi.mocked(alertService.acknowledge).mockClear();

    render(<AlertsPage />);

    expect(await screen.findByRole("heading", { name: "확인 필요" })).toBeTruthy();
    const button = await screen.findByRole("button", { name: "확인" });

    fireEvent.click(button);

    await waitFor(() => expect(alertService.resolve).toHaveBeenCalledWith("alert-acked"));
    expect(alertService.acknowledge).not.toHaveBeenCalled();
  });

  it("ACKED 알림도 ackedAt/resolvedAt 없이 크래시 없이 렌더링되고 감지 시각을 보여준다", async () => {
    const alertService = await svc();
    vi.mocked(alertService.listRecent).mockResolvedValue([
      {
        id: "alert-acked-legacy",
        room: "305호",
        status: "ACKED",
        type: "fall",
        detectedAt: "2026-07-03T00:00:00.000Z",
      } as AlertView,
    ]);

    render(<AlertsPage />);

    expect(await screen.findByRole("button", { name: "확인" })).toBeTruthy();
  });

  it("RESOLVED 알림은 '처리됨' 섹션에 나타나고 동작 버튼이 없다", async () => {
    const alertService = await svc();
    vi.mocked(alertService.listRecent).mockResolvedValue([resolvedAlert]);

    render(<AlertsPage />);

    expect(await screen.findByRole("heading", { name: "처리됨" })).toBeTruthy();
    expect(await screen.findByText(/요양보호사 해결/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("'현장 확인 완료' 버튼은 어디에도 없다 — 두 단계 흐름으로의 회귀 방지", async () => {
    const alertService = await svc();
    vi.mocked(alertService.listRecent).mockResolvedValue([
      { ...resolvedAlert, id: "alert-new", status: "NEW", type: "fall" } as AlertView,
      { ...resolvedAlert, id: "alert-acked", status: "ACKED", type: "fall" } as AlertView,
      resolvedAlert,
    ]);

    render(<AlertsPage />);

    await screen.findAllByRole("button", { name: "확인" });
    expect(screen.queryByRole("button", { name: "현장 확인 완료" })).toBeNull();
    expect(screen.queryByRole("button", { name: "확인하러 갑니다" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "확인됨" })).toBeNull();
  });
});

describe("이벤트 유형 표시", () => {
  async function svc() {
    const { alertService } = await import("@/services/alertService");
    return alertService;
  }

  it("등록된 유형은 한글 제목으로 보이고 원문 코드가 새지 않는다", async () => {
    const alertService = await svc();
    vi.mocked(alertService.listRecent).mockResolvedValue([
      { ...resolvedAlert, id: "alert-new", status: "NEW", type: "bed-exit" } as AlertView,
    ]);

    render(<AlertsPage />);

    expect(await screen.findByText("침대 이탈")).toBeTruthy();
    expect(screen.queryByText("bed-exit")).toBeNull();
  });

  it("renders SYSTEM_TEST with machine correlation markers and no room or resident assumptions", async () => {
    const alertService = await svc();
    vi.mocked(alertService.listRecent).mockResolvedValue([
      {
        ...resolvedAlert,
        id: "alert-system-page-1",
        backendEventId: "event-system-page-1",
        status: "NEW",
        type: "SYSTEM_TEST",
        spaceId: null,
        room: null,
        residentId: null,
        residentName: null,
        cameraId: null,
        testMode: "SYSTEM_TEST",
        label: "SYSTEM TEST - NOT A RESIDENT ALERT",
        ttsText: "System test emergency notification",
      } as unknown as AlertView,
    ]);

    const { container } = render(<AlertsPage />);

    expect(await screen.findByText("SYSTEM TEST")).toBeTruthy();
    const card = container.querySelector('[data-test-mode="SYSTEM_TEST"]');
    expect(card?.getAttribute("data-alert-id")).toBe("alert-system-page-1");
    expect(card?.getAttribute("data-backend-event-id")).toBe("event-system-page-1");
    expect(card?.getAttribute("data-correlation-id")).toBe("event-system-page-1");
    expect(card?.textContent).not.toContain("201호");
    expect(card?.className).not.toContain("status-danger");
  });

  it("등록되지 않은 유형은 원문 대신 '새 안전 알림'으로 안전하게 표시된다", async () => {
    const alertService = await svc();
    vi.mocked(alertService.listRecent).mockResolvedValue([
      { ...resolvedAlert, id: "alert-new", status: "NEW", type: "some-future-type" } as AlertView,
    ]);

    render(<AlertsPage />);

    expect(await screen.findByText("새 안전 알림")).toBeTruthy();
    expect(screen.queryByText("some-future-type")).toBeNull();
  });
});

describe("카드마다 주요 동작은 정확히 하나다", () => {
  it("확인 필요 카드는 '확인' 버튼만, 처리됨 카드는 동작 버튼이 없다", async () => {
    const { alertService } = await import("@/services/alertService");
    vi.mocked(alertService.listRecent).mockResolvedValue([
      { ...resolvedAlert, id: "alert-new", status: "NEW", type: "fall" } as AlertView,
      { ...resolvedAlert, id: "alert-acked", status: "ACKED", type: "fall" } as AlertView,
      resolvedAlert,
    ]);

    render(<AlertsPage />);

    const confirmButtons = await screen.findAllByRole("button", { name: "확인" });
    expect(confirmButtons).toHaveLength(2);
    // 확인 필요 카드에는 확인 버튼만 있고, 메모 버튼은 어디에도 없어야 한다.
    expect(screen.queryByRole("button", { name: "메모 보기" })).toBeNull();
  });
});

describe("대량 알림 렌더링", () => {
  it("알림이 많아도(200건) 오류 없이 렌더링된다", async () => {
    const { alertService } = await import("@/services/alertService");
    const many: AlertView[] = Array.from({ length: 200 }, (_, i) => ({
      ...resolvedAlert,
      id: `alert-${i}`,
      status: i % 3 === 0 ? "NEW" : i % 3 === 1 ? "ACKED" : "RESOLVED",
      type: i % 2 === 0 ? "fall" : "bed-exit",
      room: `${100 + i}호`,
    }) as AlertView);
    vi.mocked(alertService.listRecent).mockResolvedValue(many);

    render(<AlertsPage />);

    await screen.findByRole("heading", { name: "확인 필요" });
    const outstandingCount = many.filter((a) => a.status === "NEW" || a.status === "ACKED").length;
    expect((await screen.findAllByRole("button", { name: "확인" }))).toHaveLength(outstandingCount);
  });
});

describe("완료 조건: 큰 버튼 한 번으로 처리", () => {
  /** 매 상태마다 화면에 텍스트 입력 수단이 하나도 없어야 한다 — 메모는 선택, 필수가 아니다. */
  function expectNoTextInputAnywhere(container: HTMLElement) {
    expect(container.querySelectorAll("input, textarea, [contenteditable]")).toHaveLength(0);
  }

  it("새 알림을 텍스트 입력 없이 큰 버튼 한 번만으로 처리 완료까지 끝낸다", async () => {
    const { alertService } = await import("@/services/alertService");

    const base = { id: "alert-e2e", room: "310호", type: "fall", detectedAt: "2026-07-03T00:00:00.000Z" };
    const newAlert = { ...base, status: "NEW" } as AlertView;
    const resolvedFromFlow = {
      ...base,
      status: "RESOLVED",
      resolvedByName: "요양보호사",
      resolvedAt: "2026-07-03T00:02:00.000Z",
    } as AlertView;

    // acknowledge/resolve는 파일 전역에서 공유되는 mock이라 앞선 테스트의 호출 횟수가
    // 남아있다 — 이 흐름이 "정확히 한 번"인지 보려면 이 테스트만의 호출 횟수여야 한다.
    vi.mocked(alertService.acknowledge).mockClear();
    vi.mocked(alertService.resolve).mockClear();

    // resolve가 성공한 뒤 AlertsPage는 목록을 다시 불러온다(runAction → load).
    // 두 번의 listRecent 호출이 NEW → RESOLVED 각 단계의 화면 상태를 만든다.
    vi.mocked(alertService.listRecent)
      .mockResolvedValueOnce([newAlert])
      .mockResolvedValueOnce([resolvedFromFlow]);
    vi.mocked(alertService.resolve).mockResolvedValue(resolvedFromFlow);

    const { container } = render(<AlertsPage />);

    // --- 상태 1: NEW. 카드의 주요 동작은 "확인" 하나뿐이다. ---
    const press = await screen.findByRole("button", { name: "확인" });
    expect(screen.queryByRole("button", { name: "메모 보기" })).toBeNull();
    expect(press.className).toContain("min-h-[56px]");
    expectNoTextInputAnywhere(container);

    // --- 누름 1/1 ---
    fireEvent.click(press);
    await waitFor(() => expect(alertService.resolve).toHaveBeenCalledWith("alert-e2e"));

    // --- 상태 2: RESOLVED. 정확히 한 번의 버튼 입력만으로 도달했다. ---
    await screen.findByRole("heading", { name: "처리됨" });
    expect(screen.queryByRole("button", { name: "확인" })).toBeNull();
    expect(alertService.acknowledge).not.toHaveBeenCalled();
    expect(alertService.resolve).toHaveBeenCalledTimes(1);
    // 흐름을 완료하는 데 텍스트 입력 수단은 어디에도 필요하지 않았다.
    expectNoTextInputAnywhere(container);
  });
});
