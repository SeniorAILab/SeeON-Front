import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "senai.monitor.settings";

describe("monitorSettingsStore persistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    localStorage.clear();
  });

  it("hydrates from the persisted localStorage key on init", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        defaultFloorId: "fl_9f",
        refreshMs: 7000,
        alertSound: false,
        nightMode: true,
        cardSize: "xl",
        visibleSpaceIds: ["space-1"],
        allowAllView: false,
      }),
    );

    const { useMonitorSettingsStore } = await import("./monitorSettingsStore");
    const state = useMonitorSettingsStore.getState();

    expect(state.defaultFloorId).toBe("fl_9f");
    expect(state.refreshMs).toBe(7000);
    expect(state.alertSound).toBe(false);
    expect(state.nightMode).toBe(true);
    expect(state.cardSize).toBe("xl");
    expect(state.visibleSpaceIds).toEqual(["space-1"]);
    expect(state.allowAllView).toBe(false);
  });

  it("falls back to defaults when no persisted value exists", async () => {
    const { useMonitorSettingsStore } = await import("./monitorSettingsStore");
    const state = useMonitorSettingsStore.getState();

    // DEFAULTS.alertSound is true by design (monitorSettingsStore.ts:12) - not stale-doc "off".
    expect(state.alertSound).toBe(true);
    expect(state.nightMode).toBe(false);
    expect(state.cardSize).toBe("lg");
    expect(state.visibleSpaceIds).toBeNull();
    expect(state.allowAllView).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("persists every update() call to the localStorage key", async () => {
    const { useMonitorSettingsStore } = await import("./monitorSettingsStore");

    useMonitorSettingsStore.getState().update({ nightMode: true, refreshMs: 8000 });

    const persisted = JSON.parse(localStorage.getItem(KEY) ?? "null");
    expect(persisted).toMatchObject({ nightMode: true, refreshMs: 8000 });
    // update() must not leak store action functions into the persisted payload.
    expect(persisted.update).toBeUndefined();
    expect(persisted.reset).toBeUndefined();
  });

  it("applies an update when localStorage persistence is unavailable", async () => {
    const { useMonitorSettingsStore } = await import("./monitorSettingsStore");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });

    expect(() =>
      useMonitorSettingsStore.getState().update({ alertSound: false }),
    ).not.toThrow();
    expect(useMonitorSettingsStore.getState().alertSound).toBe(false);
  });

  it("reads back a persisted update on the next module init (round trip)", async () => {
    const first = await import("./monitorSettingsStore");
    first.useMonitorSettingsStore.getState().update({ cardSize: "xl" });

    vi.resetModules();
    const second = await import("./monitorSettingsStore");

    expect(second.useMonitorSettingsStore.getState().cardSize).toBe("xl");
  });
});
