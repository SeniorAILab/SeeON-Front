import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Env contract test: root .env.example must document exactly the VITE_*
// variables the source actually reads (either via import.meta.env in the
// browser bundle, or via loadEnv in vite.config.ts for the dev proxy),
// must not contain secret-like keys, and must stay in sync with
// src/vite-env.d.ts.

const repoRoot = path.resolve(__dirname, "../..");
const envExamplePath = path.join(repoRoot, ".env.example");
const viteEnvDtsPath = path.join(repoRoot, "src/vite-env.d.ts");
const viteConfigPath = path.join(repoRoot, "vite.config.ts");
const srcDir = path.join(repoRoot, "src");

// A forbidden retired mock-switch token, built from pieces (matching the
// approach in src/mockRetirement.scan.test.ts) so this file's own source
// text never contains the literal contiguous string and does not trip that
// scan while still exercising rejection of the token below.
const RETIRED_MOCK_SWITCH_KEY = ["VITE", "USE", "MOCK"].join("_");

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function findImportMetaEnvUsages(): Set<string> {
  const usages = new Set<string>();
  const pattern = /import\.meta\.env\.(VITE_[A-Z0-9_]+)/g;
  for (const file of listSourceFiles(srcDir)) {
    const content = fs.readFileSync(file, "utf-8");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      usages.add(match[1]);
    }
  }
  return usages;
}

// Every VITE_* variable actually consumed anywhere in the project: the
// browser bundle (import.meta.env.VITE_*) plus the Vite dev server's own
// loadEnv-based config (env.VITE_*, e.g. the dev proxy target). This is the
// full source-of-truth used to reject stale/undeclared .env.example keys.
function findAllViteVarUsages(): Set<string> {
  const usages = findImportMetaEnvUsages();
  const configContent = fs.readFileSync(viteConfigPath, "utf-8");
  const configPattern = /\benv\.(VITE_[A-Z0-9_]+)/g;
  let match: RegExpExecArray | null;
  while ((match = configPattern.exec(configContent)) !== null) {
    usages.add(match[1]);
  }
  return usages;
}

// Only active (non-commented) KEY=VALUE assignments count as declared.
function parseActiveDotEnvExample(): Map<string, string> {
  const content = fs.readFileSync(envExamplePath, "utf-8");
  const result = new Map<string, string>();
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    result.set(key, value);
  }
  return result;
}

function parseViteEnvDeclarations(): Set<string> {
  const content = fs.readFileSync(viteEnvDtsPath, "utf-8");
  const declared = new Set<string>();
  const pattern = /readonly\s+(VITE_[A-Z0-9_]+)\??\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    declared.add(match[1]);
  }
  return declared;
}

const SECRET_KEY_PATTERN = /(SECRET|TOKEN|PASSWORD|PEPPER|KEY|CREDENTIAL|PRIVATE)/i;

const EXPECTED_ACTIVE_ENV_MAP: ReadonlyMap<string, string> = new Map([
  ["VITE_API_BASE_URL", "/api/v1"],
  ["VITE_DEV_BACKEND_ORIGIN", "http://localhost:8080"],
]);

describe("frontend env contract", () => {
  it(".env.example exists at the repository root", () => {
    expect(fs.existsSync(envExamplePath)).toBe(true);
  });

  it("declares an active line for every VITE_* variable actually consumed by source", () => {
    const used = findAllViteVarUsages();
    const declaredKeys = new Set(parseActiveDotEnvExample().keys());
    expect(declaredKeys).toEqual(used);
  });

  it("publishes the exact active two-key contract with exact values", () => {
    const declared = parseActiveDotEnvExample();
    expect(declared).toEqual(EXPECTED_ACTIVE_ENV_MAP);
  });

  it("matches vite-env.d.ts ImportMetaEnv declarations exactly for import.meta.env usages", () => {
    const used = findImportMetaEnvUsages();
    const declaredInDts = parseViteEnvDeclarations();

    expect(declaredInDts).toEqual(used);
  });

  it("rejects the retired mock-switch key: unused in source and absent from the example", () => {
    const used = findAllViteVarUsages();
    const declared = parseActiveDotEnvExample();
    expect(used.has(RETIRED_MOCK_SWITCH_KEY)).toBe(false);
    expect(declared.has(RETIRED_MOCK_SWITCH_KEY)).toBe(false);
  });

  it("rejects secret-like keys in the public example file", () => {
    const declared = parseActiveDotEnvExample();
    for (const key of declared.keys()) {
      expect(SECRET_KEY_PATTERN.test(key)).toBe(false);
    }
  });

  it("never publishes a VM/host URL or non-placeholder secret value", () => {
    const declared = parseActiveDotEnvExample();
    const urlPattern = /https?:\/\/(?!localhost)/i;
    for (const value of declared.values()) {
      expect(urlPattern.test(value)).toBe(false);
      expect(value).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/); // no raw IPv4 literals
    }
  });
});
