import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import path from "path";

const REPO_ROOT = path.resolve(__dirname);
const DEFAULT_DEV_BACKEND_ORIGIN = "http://localhost:8080";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, REPO_ROOT, "");
  const backendTarget =
    env.VITE_DEV_BACKEND_ORIGIN ?? DEFAULT_DEV_BACKEND_ORIGIN;

  return {
    plugins: [react()],
    envDir: REPO_ROOT,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 3000,
      strictPort: true,
      proxy: {
        "/api": backendTarget,
      },
    },
    preview: {
      port: 3000,
      strictPort: true,
    },
    test: {
      environment: "jsdom",
      env: {
        VITE_API_BASE_URL: "/api/v1",
      },
      globals: false,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
  };
});
