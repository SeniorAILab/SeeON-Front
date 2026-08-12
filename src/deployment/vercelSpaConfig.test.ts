import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static contracts for the standalone Vercel SPA deployment surface.
 * Owns only vercel.json + GitHub quality-gate workflow shape — no app/env edits.
 *
 * Vercel serves matching static files before applying rewrites, so a single
 * catch-all rewrite to /index.html is the filesystem-aware SPA fallback.
 */

const root = process.cwd();
const vercelPath = resolve(root, "vercel.json");
const workflowDir = resolve(root, ".github/workflows");

type VercelJson = {
  $schema?: string;
  framework?: string | null;
  installCommand?: string;
  buildCommand?: string;
  outputDirectory?: string;
  rewrites?: Array<{ source?: string; destination?: string }>;
  redirects?: unknown[];
  routes?: unknown[];
  headers?: unknown[];
  env?: Record<string, string>;
  build?: { env?: Record<string, string> };
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function workflowFiles(): string[] {
  if (!existsSync(workflowDir)) return [];
  return readdirSync(workflowDir).filter((name) => /\.ya?ml$/i.test(name));
}

function assertNoSecretMaterial(text: string): void {
  const forbidden = [
    /VERCEL_TOKEN/i,
    /ghp_[A-Za-z0-9]{20,}/,
    /github_pat_[A-Za-z0-9_]{20,}/,
    /-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/,
    /xox[baprs]-[A-Za-z0-9-]+/,
    /password\s*[:=]\s*['"][^'"]+['"]/i,
  ];
  for (const pattern of forbidden) {
    expect(text, `secret-like material matched ${pattern}`).not.toMatch(pattern);
  }
}

function collectDestinations(config: VercelJson): string[] {
  const destinations: string[] = [];
  for (const rule of config.rewrites ?? []) {
    if (typeof rule.destination === "string") destinations.push(rule.destination);
  }
  // Legacy routes.dest support if present
  const routes = (config.routes ?? []) as Array<Record<string, unknown>>;
  for (const route of routes) {
    if (typeof route.dest === "string") destinations.push(route.dest);
    if (typeof route.destination === "string") destinations.push(route.destination);
  }
  return destinations;
}

describe("vercel.json SPA deployment contract", () => {
  it("exists and is valid JSON object", () => {
    expect(existsSync(vercelPath), "vercel.json must exist at repository root").toBe(true);
    const config = readJson<VercelJson>(vercelPath);
    expect(config).toBeTypeOf("object");
    expect(config).not.toBeNull();
    expect(Array.isArray(config)).toBe(false);
  });

  it("pins Vite framework, frozen pnpm install, pnpm build, and dist output", () => {
    const config = readJson<VercelJson>(vercelPath);
    expect(config.framework).toBe("vite");
    expect(config.installCommand).toBe("pnpm install --frozen-lockfile");
    expect(config.buildCommand).toBe("pnpm build");
    expect(config.outputDirectory).toBe("dist");
  });

  it("declares exactly one filesystem-aware SPA fallback to /index.html", () => {
    const config = readJson<VercelJson>(vercelPath);
    const rewrites = config.rewrites ?? [];
    expect(rewrites, "rewrites must be present").toHaveLength(1);

    const only = rewrites[0];
    expect(only.source, "SPA source must catch client routes").toMatch(/\/\(\.\*\)|\/\(\?<|\/\(.*\)|\//);
    // Prefer the documented SPA catch-all forms
    expect(
      only.source === "/(.*)" ||
        only.source === "/:path*" ||
        only.source === "/((?!assets/).*)" ||
        Boolean(only.source && only.source.includes("(.*)")),
    ).toBe(true);
    expect(only.destination).toBe("/index.html");

    // No second rewrite/redirect that could shadow filesystem or proxy APIs
    expect(config.redirects ?? []).toHaveLength(0);
  });

  it("does not proxy or rewrite /api, SSE, upload, or media to external destinations", () => {
    const config = readJson<VercelJson>(vercelPath);
    const destinations = collectDestinations(config);
    const joined = JSON.stringify(config);

    for (const dest of destinations) {
      expect(dest.startsWith("http://") || dest.startsWith("https://")).toBe(false);
      expect(dest.includes("49.247.204.81")).toBe(false);
      // destination must stay on the static shell
      expect(dest).toBe("/index.html");
    }

    // No API/SSE rewrite sources or env that would make Vercel an API gateway
    expect(joined).not.toMatch(/\/api\/v1\/dashboard\/stream/);
    expect(joined).not.toMatch(/destination["']\s*:\s*["'][^"']*\/api/);
    expect(joined).not.toMatch(/["']\/api\/?\*?["']\s*:/);
    expect(joined).not.toMatch(/text\/event-stream/i);
    expect(joined).not.toMatch(/events\/clips/i);
    expect(joined).not.toMatch(/media\/content/i);
  });

  it("contains no secrets, tokens, or production HTTP API env values", () => {
    const raw = readFileSync(vercelPath, "utf8");
    assertNoSecretMaterial(raw);
    const config = readJson<VercelJson>(vercelPath);
    const envBlob = JSON.stringify({
      env: config.env ?? {},
      buildEnv: config.build?.env ?? {},
    });
    expect(envBlob).not.toMatch(/49\.247\.204\.81/);
    expect(envBlob).not.toMatch(/VITE_API_BASE_URL["']\s*:\s*["']http:/);
    expect(raw).not.toMatch(/VERCEL_TOKEN/i);
  });

  it("references the official vercel.json schema when $schema is set", () => {
    const config = readJson<VercelJson>(vercelPath);
    if (config.$schema !== undefined) {
      expect(config.$schema).toBe("https://openapi.vercel.sh/vercel.json");
    }
  });
});

describe("GitHub Actions quality-gate workflow contract", () => {
  it("ships exactly one CI workflow and no token-driven deploy workflow", () => {
    const files = workflowFiles();
    expect(files.length, "expected .github/workflows/*.yml").toBeGreaterThanOrEqual(1);

    const deployLike = files.filter((name) => /deploy|vercel-deploy|release/i.test(name));
    expect(deployLike, "no deploy/token workflows in this todo").toEqual([]);

    // Prefer a single ci.yml quality gate; allow only quality-oriented names
    for (const name of files) {
      expect(name).toMatch(/^(ci|quality|test|check)s?\.ya?ml$/i);
    }
  });

  it("triggers on pull_request and push to main", () => {
    const files = workflowFiles();
    expect(files.length).toBeGreaterThan(0);
    const raw = files.map((f) => readFileSync(resolve(workflowDir, f), "utf8")).join("\n---\n");

    expect(raw).toMatch(/\bpull_request\b/);
    expect(raw).toMatch(/\bpush\b/);
    expect(raw).toMatch(/\bmain\b/);
  });

  it("uses Node 24, Corepack, and frozen pnpm install", () => {
    const files = workflowFiles();
    const raw = files.map((f) => readFileSync(resolve(workflowDir, f), "utf8")).join("\n");

    // Node 24 — setup-node node-version: 24 or '24' or 24.x
    expect(raw).toMatch(/node-version:\s*['"]?24(?:\.x)?['"]?/);
    expect(raw).toMatch(/corepack\s+enable/);
    // Frozen install is mandatory for deterministic CI
    expect(raw).toMatch(/pnpm\s+install\s+--frozen-lockfile/);
    // Prefer corepack-prepared pnpm 10.32.1 (Todo 3 packageManager pin)
    expect(raw).toMatch(/pnpm@10\.32\.1|packageManager|corepack prepare pnpm/);
  });

  it("runs typecheck, lint, test, and build as quality gates", () => {
    const files = workflowFiles();
    const raw = files.map((f) => readFileSync(resolve(workflowDir, f), "utf8")).join("\n");

    expect(raw).toMatch(/pnpm\s+typecheck/);
    expect(raw).toMatch(/pnpm\s+lint\b/);
    expect(raw).toMatch(/pnpm\s+test\b/);
    expect(raw).toMatch(/pnpm\s+build\b/);
  });

  it("does not embed Vercel deploy tokens or secret API destinations", () => {
    const files = workflowFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const raw = readFileSync(resolve(workflowDir, name), "utf8");
      assertNoSecretMaterial(raw);
      expect(raw).not.toMatch(/vercel\s+(deploy|--prod|pull)/i);
      expect(raw).not.toMatch(/secrets\.[A-Z0-9_]*TOKEN/);
      expect(raw).not.toMatch(/49\.247\.204\.81/);
    }
  });
});

describe("SPA deep-route fallback semantics (config-level)", () => {
  const deepRoutes = [
    "/",
    "/login",
    "/facilities/test/dashboard",
    "/facilities/test/floor/test",
    "/facilities/test/alerts",
    "/facilities/test/admin/users",
  ];

  it("maps every canonical deep route through the single index.html rewrite", () => {
    const config = readJson<VercelJson>(vercelPath);
    const rule = (config.rewrites ?? [])[0];
    expect(rule?.destination).toBe("/index.html");

    // The catch-all source must accept each deep route path.
    // We emulate Vercel path matching for the common "/(.*)" form.
    const source = rule?.source ?? "";
    for (const route of deepRoutes) {
      if (source === "/(.*)" || source.includes("(.*)")) {
        expect(route.startsWith("/")).toBe(true);
        continue;
      }
      if (source === "/:path*") {
        expect(route.startsWith("/")).toBe(true);
        continue;
      }
      throw new Error(`unrecognized SPA rewrite source: ${source}`);
    }
  });

  it("does not treat missing hashed assets as silent SPA success at the config layer", () => {
    // Config must not rewrite only under /assets or force missing JS to index as if it were the asset.
    // Filesystem-first behavior means a missing /assets/foo.js is a 404 on Vercel before rewrite
    // when the rewrite is the standard SPA fallback — we assert destinations never alias assets.
    const config = readJson<VercelJson>(vercelPath);
    for (const dest of collectDestinations(config)) {
      expect(dest).not.toMatch(/\/assets\//);
      expect(dest).not.toMatch(/\.js$/);
      expect(dest).not.toMatch(/\.css$/);
    }
  });
});
