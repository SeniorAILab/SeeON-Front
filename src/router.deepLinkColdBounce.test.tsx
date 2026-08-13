import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/components/RequireAuth";
import { RouterBootstrap } from "@/components/RouterBootstrap";
import { FacilityScope } from "@/components/FacilityRouteScope";
import { StaffLayout } from "@/components/layout/StaffLayout";
import { LoginPage } from "@/pages/LoginPage";
import { FloorSelectLandingPage } from "@/features/monitor";
import { useAuthStore } from "@/stores/authStore";
import { useFacilityStore } from "@/stores/facilityStore";

// 스코프 픽스처는 파일당 상수 하나에서만 유도한다 — 경로/단언이 같은 리터럴의
// 수기 일치에 의존하지 않게 한다 (front/src/AGENTS.md 컨벤션).
const DEEP_LINK_FACILITY_ID = "fac_deep_link_survivor";
const DEEP_LINK_PATH = `/facilities/${DEEP_LINK_FACILITY_ID}/floors`;

const LOGIN_USER_DTO = {
  id: "u_deep_link_staff",
  email: "staff@sen.ai",
  nickname: "이간호",
  role: "STAFF",
  facilityId: DEEP_LINK_FACILITY_ID,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

// 콜드 부팅 시나리오의 유일한 네트워크 표면: `/auth/me`는 401, 로그인은 성공,
// 백그라운드에서 뜨는 시설/층/공간/알림 목록은 조용히 빈 값으로 응답해
// 로그인 이후 배경 위젯이 또 다른(무관한) 401 바운스를 유발하지 않게 한다.
function buildColdBootFetchMock() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = urlOf(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "GET" && url.endsWith("/auth/me")) {
      return jsonResponse({ message: "Unauthorized" }, 401);
    }
    if (method === "POST" && url.endsWith("/auth/login")) {
      return jsonResponse({ user: LOGIN_USER_DTO });
    }
    if (method === "GET" && /\/facilities\/[^/?]+(?:\?|$)/.test(url)) {
      return jsonResponse({ id: DEEP_LINK_FACILITY_ID, name: "행복요양원", address: "", phone: "" });
    }
    return jsonResponse([]);
  });
}

// 라우터의 실제 위치를 렌더된 화면에서만 관찰한다 - `router.tsx`가 조립하는
// 것과 동일한 컴포넌트 트리(RouterBootstrap→RequireAuth→FacilityScope→
// StaffLayout)를 그대로 쓰되, 데이터 라우터(`createMemoryRouter`+
// `RouterProvider`)는 이 jsdom 환경에서 내비게이션마다 내부적으로
// `Request`/`AbortController`를 새로 만들다가 realm 불일치로 매번
// unhandled rejection을 던져 항상 실패한다 — 그래서 이 저장소의 기존
// 라우터 스펙(`router.navigationShell.test.tsx`)과 같은 선언형
// `MemoryRouter`+`Routes` 스타일을 그대로 따른다.
function LocationProbe() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "";
  return (
    <div>
      <span data-testid="probe-path">{location.pathname}</span>
      <span data-testid="probe-search">{location.search}</span>
      <span data-testid="probe-from">{from}</span>
    </div>
  );
}

function renderRealRouteTree(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/login"
          element={
            <RouterBootstrap>
              <LoginPage />
            </RouterBootstrap>
          }
        />
        <Route
          path="/facilities/:facilityId/floors"
          element={
            <RouterBootstrap>
              <RequireAuth>
                <FacilityScope>
                  <StaffLayout />
                </FacilityScope>
              </RequireAuth>
            </RouterBootstrap>
          }
        >
          <Route index element={<FloorSelectLandingPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ user: null, initialized: false, loading: false, error: null });
  useFacilityStore.setState({ currentFacilityId: null, facilities: [] });
  window.history.replaceState(null, "", DEEP_LINK_PATH);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cold entry deep link survives the auth bounce", () => {
  it("keeps the deep link through a never-authenticated 401 and returns to it after login", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: DEEP_LINK_PATH, assign });
    vi.stubGlobal("fetch", buildColdBootFetchMock());

    renderRealRouteTree(DEEP_LINK_PATH);

    await waitFor(() => expect(screen.getByTestId("probe-path").textContent).toBe("/login"));

    // (1) THE assertion that actually binds the bug: in jsdom `assign` is a
    // silent no-op, so a spec that only checks the rendered route passes even
    // with the bug present, because the router's own <Navigate> put it there.
    expect(assign).not.toHaveBeenCalled();

    // (2) clean landing: no reason query, no expiry copy.
    expect(screen.getByTestId("probe-search").textContent).toBe("");
    expect(
      screen.queryByText("로그인 시간이 만료되었습니다. 다시 로그인해 주세요."),
    ).toBeNull();

    // (3) the deep link survives as router state for the post-login bounce-back.
    expect(screen.getByTestId("probe-from").textContent).toBe(DEEP_LINK_PATH);

    // (4) logging in from here returns to the original deep link.
    fireEvent.change(await screen.findByPlaceholderText("name@facility.com"), {
      target: { value: "staff@sen.ai" },
    });
    fireEvent.change(screen.getByPlaceholderText("비밀번호"), {
      target: { value: "care2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "이메일로 로그인" }));

    await waitFor(() => expect(screen.getByTestId("probe-path").textContent).toBe(DEEP_LINK_PATH));
    expect(assign).not.toHaveBeenCalled();
  });

  it("control case: a user who already has a session renders the deep link directly, no login detour", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = urlOf(input);
        // `/auth/me`는 세션 사용자 DTO를 그대로 돌려준다 - 로그인/회원가입
        // 응답과 달리 `{ user }`로 감싸지 않는다 (`authEndpoints.ts` restoreSessionEndpoint).
        if (url.endsWith("/auth/me")) return jsonResponse(LOGIN_USER_DTO);
        if (/\/facilities\/[^/?]+(?:\?|$)/.test(url)) {
          return jsonResponse({ id: DEEP_LINK_FACILITY_ID, name: "행복요양원", address: "", phone: "" });
        }
        return jsonResponse([]);
      }),
    );

    renderRealRouteTree(DEEP_LINK_PATH);

    await waitFor(() => expect(screen.getByTestId("probe-path").textContent).toBe(DEEP_LINK_PATH));
    expect(screen.queryByPlaceholderText("name@facility.com")).toBeNull();
  });
});
