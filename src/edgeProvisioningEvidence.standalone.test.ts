/** @vitest-environment node */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getEdgeProvisioningEvidenceDirectory } from "../e2e/evidence-directory";

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

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const defaultDirectory =
  path.join(repositoryRoot, "test-results", "edge-provisioning") + path.sep;

describe("standalone edge provisioning evidence directory", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("anchors the default inside this repository independently of cwd", () => {
    vi.stubEnv("EDGE_PROVISIONING_EVIDENCE_DIR", undefined);
    vi.spyOn(process, "cwd").mockReturnValue(path.resolve(repositoryRoot, ".."));

    const directory = getEdgeProvisioningEvidenceDirectory();

    expect(directory).toBe(defaultDirectory);
    expect(path.isAbsolute(directory)).toBe(true);
    expect(path.relative(repositoryRoot, directory)).toBe(
      path.join("test-results", "edge-provisioning"),
    );
  });

  it.each([
    ["relative", "./evidence/../keep-as-written/"],
    ["absolute", path.resolve(repositoryRoot, "..", "explicit-edge-evidence")],
    ["empty", ""],
  ])("preserves the %s override verbatim", (_label, override) => {
    vi.stubEnv("EDGE_PROVISIONING_EVIDENCE_DIR", override);

    expect(getEdgeProvisioningEvidenceDirectory()).toBe(override);
  });

  it("reads the override on each call rather than capturing it at import time", () => {
    vi.stubEnv("EDGE_PROVISIONING_EVIDENCE_DIR", "first");
    expect(getEdgeProvisioningEvidenceDirectory()).toBe("first");

    vi.stubEnv("EDGE_PROVISIONING_EVIDENCE_DIR", "../second");
    expect(getEdgeProvisioningEvidenceDirectory()).toBe("../second");

    vi.stubEnv("EDGE_PROVISIONING_EVIDENCE_DIR", "");
    expect(getEdgeProvisioningEvidenceDirectory()).toBe("");

    vi.stubEnv("EDGE_PROVISIONING_EVIDENCE_DIR", undefined);
    expect(getEdgeProvisioningEvidenceDirectory()).toBe(defaultDirectory);
  });
});
