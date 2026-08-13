import { beforeEach, describe, expect, it, vi } from "vitest";

import { alertService } from "./alertService";
import { listAlertsEndpoint, resolveAlertEndpoint } from "./api/alertEndpoints";
import {
  getAlertMediaEndpoint,
  recordAlertMediaAccessEndpoint,
} from "./api/alertMedia";

vi.mock("./api/alertEndpoints", () => ({
  listAlertsEndpoint: vi.fn(),
  resolveAlertEndpoint: vi.fn(),
}));

vi.mock("./api/alertMedia", () => ({
  getAlertMediaEndpoint: vi.fn(),
  recordAlertMediaAccessEndpoint: vi.fn(),
}));



const getAlertMediaEndpointMock = vi.mocked(getAlertMediaEndpoint);
const listAlertsEndpointMock = vi.mocked(listAlertsEndpoint);
const recordAlertMediaAccessEndpointMock = vi.mocked(recordAlertMediaAccessEndpoint);
const resolveAlertEndpointMock = vi.mocked(resolveAlertEndpoint);

describe("alertService endpoint delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps listing open alerts through the NEW alert endpoint filter", async () => {
    listAlertsEndpointMock.mockResolvedValue([]);

    await alertService.listOpen();

    expect(listAlertsEndpointMock).toHaveBeenCalledTimes(1);
    expect(listAlertsEndpointMock).toHaveBeenCalledWith({ status: "NEW" });
  });

  it("resolves alerts through resolveAlertEndpoint", async () => {
    resolveAlertEndpointMock.mockResolvedValue({ id: "a1" } as never);

    await alertService.resolve("a1");

    expect(resolveAlertEndpointMock).toHaveBeenCalledTimes(1);
    expect(resolveAlertEndpointMock).toHaveBeenCalledWith("a1");
  });



  it("loads alert media through the typed endpoint with cancellation", async () => {
    const controller = new AbortController();
    getAlertMediaEndpointMock.mockResolvedValue({
      status: "UNAVAILABLE",
      alertId: "alert-1",
    });

    await alertService.getMedia("alert-1", controller.signal);

    expect(getAlertMediaEndpointMock).toHaveBeenCalledWith(
      "alert-1",
      controller.signal,
    );
  });

  it("records only the alert-bound media action payload", async () => {
    recordAlertMediaAccessEndpointMock.mockResolvedValue(undefined);

    await alertService.recordMediaAccess({
      alertId: "alert-1",
      action: "PLAY_STARTED",
      interactionId: "interaction-1",
    });

    expect(recordAlertMediaAccessEndpointMock).toHaveBeenCalledWith({
      alertId: "alert-1",
      action: "PLAY_STARTED",
      interactionId: "interaction-1",
    });
  });
});
