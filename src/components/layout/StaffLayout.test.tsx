import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StaffLayout } from "@/components/layout/StaffLayout";
import { useAuthStore } from "@/stores/authStore";
import { useFacilityStore } from "@/stores/facilityStore";

// jsdom은 스타일시트를 로드하지 않고 grid-template-columns 같은 shorthand를 계산하지
// 않는다 (src/components/status/RoomStatusTreemap.test.tsx:196 참고). 그래서 여기서는
// 렌더된 실제 지오메트리가 아니라 리터럴 className 문자열과 DOM 구조만 단언한다.

function okJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const facilityId = "fac_happy_nokyang";

function renderShell(child: ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/staff"]}>
      <Routes>
        <Route path="/staff" element={<StaffLayout />}>
          <Route index element={child} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("StaffLayout shell", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(okJsonResponse([])));
    useAuthStore.setState({
      user: {
        id: "staff-1",
        name: "Care Staff",
        email: "staff@example.test",
        role: "STAFF",
        facilityId,
      },
    });
    useFacilityStore.setState({ currentFacilityId: null, facilities: [] });
  });

  it("uses a two-row min-h-[100dvh] grid shell instead of min-h-screen", async () => {
    const { container } = renderShell(<div>child content</div>);
    await screen.findByText("child content");

    const shellRoot = container.firstElementChild;
    expect(shellRoot).toBeTruthy();
    expect(shellRoot?.className).toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(shellRoot?.className).toContain("min-h-[100dvh]");
    expect(shellRoot?.className).not.toContain("min-h-screen");
  });

  it("hands the outlet row to a page-grid main with no hardcoded max-w-5xl", async () => {
    const { container } = renderShell(<div>child content</div>);
    await screen.findByText("child content");

    const main = container.querySelector("main");
    expect(main).toBeTruthy();
    expect(main?.className).toContain("page-grid");
    expect(main?.className).toContain("min-h-0");
    expect(main?.className).not.toContain("max-w-5xl");
  });

  it("lets an outlet child opt into page-bleed while a normal child stays centered", async () => {
    const { container: bleedContainer } = renderShell(
      <div data-testid="bleed-child" className="page-bleed">
        bleed content
      </div>,
    );
    await screen.findByText("bleed content");
    const bleedChild = bleedContainer.querySelector('[data-testid="bleed-child"]');
    expect(bleedChild?.className).toContain("page-bleed");

    const { container: normalContainer } = renderShell(
      <div data-testid="normal-child">normal content</div>,
    );
    await screen.findByText("normal content");
    const normalChild = normalContainer.querySelector('[data-testid="normal-child"]');
    expect(normalChild?.className ?? "").not.toContain("page-bleed");
  });
});
