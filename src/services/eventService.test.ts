import { beforeEach, describe, expect, it, vi } from "vitest";
const SCOPED_FACILITY_ID = "fac_happy_nokyang";


function okJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const alertDto = {
  alertSeq: "10",
  id: "alert_201",
  facilityId: SCOPED_FACILITY_ID,
  residentId: null,
  cameraId: "cam_sp_201",
  spaceId: "sp_201",
  room: "201호",
  type: "bed-exit",
  probability: 0.92,
  detectedAt: "2026-06-22T01:00:00.000Z",
  status: "RESOLVED",
};

describe("eventService real mode actions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("routes staff acknowledge to the ack endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/alerts/alert_201/ack") && init?.method === "PATCH") {
        return okJsonResponse(alertDto);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { eventService } = await import("./eventService");
    const event = await eventService.acknowledge("alert_201", "Care Staff");

    // 확인(ACK)은 해결(RESOLVE)과 다른 라우트다. 예전에는 확인이 곧바로
    // RESOLVED로 끝나 확인됨/해결완료 2단계가 죽어 있었다.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/alerts/alert_201/ack",
      expect.objectContaining({ method: "PATCH", credentials: "include" })
    );
    expect(event).toMatchObject({
      id: "alert_201",
      acknowledgedBy: "Care Staff",
    });
  });

});

describe("I1 — 목록 50건 밖 사건도 열린다", () => {
  it("getById는 목록이 아니라 단건 라우트를 직접 조회한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      // 목록 라우트를 부르면 실패시킨다 — 목록 의존이 남아 있으면 여기서 터진다.
      if (url.endsWith("/alerts")) throw new Error("목록을 조회하면 안 된다");
      if (url.includes("/notes")) throw new Error("notes 라우트를 호출하면 안 된다");
      if (url.endsWith("/alerts/alert_999")) return okJsonResponse(alertDto);
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { eventService } = await import("./eventService");
    const event = await eventService.getById("alert_999");

    expect(event).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/alerts/alert_999",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("없는 사건은 목록을 뒤지지 않고 undefined를 돌려준다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/alerts")) throw new Error("목록을 조회하면 안 된다");
      if (url.includes("/notes")) throw new Error("notes 라우트를 호출하면 안 된다");
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { eventService } = await import("./eventService");
    await expect(eventService.getById("alert_missing")).resolves.toBeUndefined();
  });

  it("/notes 라우트는 절대 호출되지 않고 단건 조회는 성공한다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      // /notes를 포함한 모든 요청은 거부한다 — 메모 기능이 완전히 제거되었음을 증명
      if (url.includes("/notes")) {
        throw new Error("notes 라우트를 호출하면 안 된다");
      }
      if (url.endsWith("/alerts")) throw new Error("목록을 조회하면 안 된다");
      if (url.endsWith("/alerts/alert_999")) return okJsonResponse(alertDto);
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { eventService } = await import("./eventService");
    const event = await eventService.getById("alert_999");

    expect(event).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/alerts/alert_999",
      expect.objectContaining({ credentials: "include" })
    );
    // /notes를 호출하지 않았음을 암묵적으로 증명 (에러를 던지지 않았으므로)
  });
});
