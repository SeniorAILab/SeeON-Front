import { create } from "zustand";
import { authService } from "@/services/authService";
import { setUnauthorizedHandler } from "@/services/apiClient";
import type {
  CreateFacilityInput,
  LoginInput,
  RegisterInput,
} from "@/services/authService";
import type { User } from "@/types";

interface AuthState {
  user: User | null;
  initialized: boolean;
  loading: boolean;
  error: string | null;
  restoreError: string | null;
  init: () => Promise<void>;
  login: (input: LoginInput) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  createFacility: (input: CreateFacilityInput) => Promise<User>;
  logout: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청 처리 중 오류가 발생했습니다.";
}

let initializationPromise: Promise<void> | null = null;
let authGeneration = 0;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  initialized: false,
  loading: false,
  error: null,
  restoreError: null,

  init: () => {
    if (get().initialized) return Promise.resolve();
    if (initializationPromise) return initializationPromise;

    const generation = authGeneration;
    set({ loading: true, restoreError: null });
    initializationPromise = authService
      .bootstrap()
      .then((session) => {
        if (generation !== authGeneration) return;
        set({
          user: session?.user ?? null,
          initialized: true,
          loading: false,
          restoreError: null,
        });
      })
      .catch(() => {
        if (generation !== authGeneration) return;
        set({
          user: null,
          initialized: true,
          loading: false,
          restoreError: "로그인 상태를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
        });
      })
      .finally(() => {
        initializationPromise = null;
      });

    return initializationPromise;
  },

  login: async (input) => {
    set({ loading: true, error: null });
    try {
      const session = await authService.login(input);
      authGeneration += 1;
      set({
        user: session.user,
        initialized: true,
        loading: false,
        restoreError: null,
      });
      return session.user;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      throw error;
    }
  },

  register: async (input) => {
    set({ loading: true, error: null });
    try {
      const session = await authService.register(input);
      authGeneration += 1;
      set({
        user: session.user,
        initialized: true,
        loading: false,
        restoreError: null,
      });
      return session.user;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      throw error;
    }
  },

  createFacility: async (input) => {
    set({ loading: true, error: null });
    try {
      const session = await authService.createFacility(input);
      authGeneration += 1;
      set({
        user: session.user,
        initialized: true,
        loading: false,
        restoreError: null,
      });
      return session.user;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      throw error;
    }
  },

  logout: async () => {
    await authService.logout();
    authGeneration += 1;
    set({ user: null, initialized: true, loading: false, restoreError: null });
  },
}));

setUnauthorizedHandler(() => {
  const hadSession = useAuthStore.getState().user !== null;
  authGeneration += 1;
  useAuthStore.setState({
    user: null,
    initialized: true,
    loading: false,
    restoreError: null,
  });
  if (!hadSession) return;
  if (window.location.pathname !== "/login") {
    window.location.assign("/login?reason=session-invalid");
  }
});
