import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRealtimeSpaceStatus } from "./useRealtimeSpaceStatus";
import { useMonitorStore } from "@/stores/monitorStore";
import { useMonitorSettingsStore } from "@/features/monitor/stores/monitorSettingsStore";
import type { Space } from "@/types";

const startMock = vi.fn();
const stopMock = vi.fn();

const spaces: Space[] = [];
const facilityId = "facility-realtime-refresh";

describe("useRealtimeSpaceStatus refreshMs wiring", () => {
  beforeEach(() => {
    startMock.mockClear();
    stopMock.mockClear();
    useMonitorStore.setState({ start: startMock, stop: stopMock, statuses: {} });
    useMonitorSettingsStore.setState({ refreshMs: 6000 });
  });

  it("starts the monitor with the current facility and refreshMs", () => {
    renderHook(() => useRealtimeSpaceStatus(facilityId, spaces));

    expect(startMock).toHaveBeenLastCalledWith(facilityId, 6000);
  });

  it("restarts the monitor engine when refreshMs changes", () => {
    const { rerender } = renderHook(
      ({ id, list }) => useRealtimeSpaceStatus(id, list),
      { initialProps: { id: facilityId, list: spaces } },
    );

    expect(startMock).toHaveBeenLastCalledWith(facilityId, 6000);

    useMonitorSettingsStore.setState({ refreshMs: 5000 });
    rerender({ id: facilityId, list: spaces });

    expect(startMock).toHaveBeenLastCalledWith(facilityId, 5000);
    expect(startMock).toHaveBeenCalledTimes(2);
    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
