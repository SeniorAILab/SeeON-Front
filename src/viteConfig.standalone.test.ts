/** @vitest-environment node */
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigEnv, UserConfig } from "vite";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    key: (index: number) => [...map.keys()][index] ?? null,
  };
}

// setup.ts clears browser storage after each test; provide a node-safe stub.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: memoryStorage(),
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: memoryStorage(),
});

async function loadViteConfig(
  env: ConfigEnv = { mode: "development", command: "serve" },
): Promise<UserConfig> {
  vi.resetModules();
  const mod = await import("../vite.config");
  const exported = mod.default;
  const resolved =
    typeof exported === "function" ? await exported(env) : exported;
  return resolved as UserConfig;
}

describe("standalone vite environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.VITE_DEV_BACKEND_ORIGIN;
    delete process.env.BACKEND_PORT;
    delete process.env.PORT;
  });

  it("loads env only from the repository root (no parent envDir)", async () => {
    const config = await loadViteConfig();
    const envDir = path.resolve(String(config.envDir ?? ""));
    const repoRoot = path.resolve(import.meta.dirname, "..");

    expect(envDir).toBe(repoRoot);
    expect(envDir).not.toBe(path.resolve(repoRoot, ".."));
  });

  it("proxies /api to VITE_DEV_BACKEND_ORIGIN and defaults to localhost:8080", async () => {
    delete process.env.VITE_DEV_BACKEND_ORIGIN;
    // Parent monorepo PORT/BACKEND_PORT must not steer the standalone proxy.
    process.env.BACKEND_PORT = "9999";
    process.env.PORT = "7777";
    const defaultConfig = await loadViteConfig();
    expect(defaultConfig.server?.proxy).toMatchObject({
      "/api": "http://localhost:8080",
    });

    process.env.VITE_DEV_BACKEND_ORIGIN = "http://127.0.0.1:9090";
    const customConfig = await loadViteConfig();
    expect(customConfig.server?.proxy).toMatchObject({
      "/api": "http://127.0.0.1:9090",
    });
  });

  it("does not proxy unused /ingest in development", async () => {
    const config = await loadViteConfig();
    const proxy = config.server?.proxy ?? {};
    expect(proxy).not.toHaveProperty("/ingest");
  });
});
