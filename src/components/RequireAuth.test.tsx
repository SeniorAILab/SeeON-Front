import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./RequireAuth";
import { useAuthStore } from "@/stores/authStore";
const SCOPED_FACILITY_ID = "fac_happy_nokyang";


beforeEach(() => {
  useAuthStore.setState({
    user: {
      id: "u_staff",
      name: "이간호",
      email: "staff@sen.ai",
      role: "STAFF",
      facilityId: SCOPED_FACILITY_ID,
    },
    loading: false,
    error: null,
    initialized: true,
  });
});

function renderAdminRoute() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route
          path="/admin"
          element={
            <RequireAuth minRole="ADMIN">
              <div>ADMIN_DASHBOARD</div>
            </RequireAuth>
          }
        />
        <Route path="/access-denied" element={<div>ACCESS_DENIED_PAGE</div>} />
        <Route path="/dashboard" element={<div>WRONG_DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("RequireAuth", () => {
  it("요양 보호사가 관리자 경로로 접근하면 접근 거부 화면으로 보낸다", () => {
    renderAdminRoute();
    expect(screen.getByText("ACCESS_DENIED_PAGE")).toBeTruthy();
  });

  it("세션 확인 장애를 로그아웃으로 오인하지 않고 다시 시도할 수 있게 한다", () => {
    const init = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({
      user: null,
      initialized: true,
      loading: false,
      error: "로그인 상태를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
      init,
    });

    renderAdminRoute();

    expect(screen.getByRole("alert").textContent).toContain(
      "로그인 상태를 확인하지 못했습니다.",
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(init).toHaveBeenCalledOnce();
  });
});
