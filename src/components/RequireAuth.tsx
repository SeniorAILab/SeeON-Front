import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { forbiddenPathForUser } from "@/lib/routeAccess";
import { hasRole } from "@/lib/roles";
import type { Role } from "@/types";

export function RequireAuth({
  children,
  minRole,
}: {
  children: React.ReactNode;
  minRole?: Role;
}) {
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const restoreError = useAuthStore((s) => s.restoreError);
  const init = useAuthStore((s) => s.init);
  const location = useLocation();

  if (!initialized) return null;
  if (!user && restoreError) {
    return (
      <div
        role="alert"
        className="mx-auto mt-16 flex max-w-lg flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-8 text-center"
      >
        <p className="font-semibold text-ink">{restoreError}</p>
        <button
          type="button"
          className="min-h-12 rounded-xl bg-primary px-6 font-bold text-white"
          onClick={() => {
            useAuthStore.setState({ initialized: false });
            void init();
          }}
        >
          다시 시도
        </button>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (minRole && !hasRole(user, minRole)) {
    return <Navigate to={forbiddenPathForUser(user)} replace />;
  }
  return <>{children}</>;
}
