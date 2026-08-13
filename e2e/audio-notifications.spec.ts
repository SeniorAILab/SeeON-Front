import { expect, test, type Page } from "@playwright/test";

const FIXTURE = {
  facilityId: "fac_happy_nokyang",
  floorId: "fl_2f",
  spaceId: "sp_201",
} as const;

const monitorRoutes = [
  `/facilities/${FIXTURE.facilityId}/dashboard`,
  `/facilities/${FIXTURE.facilityId}/floor/${FIXTURE.floorId}`,
] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ facilityId }) => {
    localStorage.setItem(
      "senai.monitor.settings",
      JSON.stringify({ alertSound: true }),
    );
    sessionStorage.setItem("eldercare.currentFacilityId", facilityId);

    class IsolatedEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readonly readyState = IsolatedEventSource.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        this.url = String(url);
      }

      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return true;
      }
      close() {}
    }

    window.EventSource = IsolatedEventSource as unknown as typeof EventSource;

    const documentFullscreen = Object.getOwnPropertyDescriptor(
      document,
      "fullscreenElement",
    );
    const requestFullscreen = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "requestFullscreen",
    );
    const exitFullscreen = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
    let fullscreenElement: Element | null = null;

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    const enterFullscreen = (element: Element) => {
      fullscreenElement = element;
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: function requestFullscreenMock() {
        enterFullscreen(this);
        return Promise.resolve();
      },
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: function exitFullscreenMock() {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      },
    });

    const testWindow = window as typeof window & {
      __restoreAudioNotificationsFullscreen?: () => void;
    };
    testWindow.__restoreAudioNotificationsFullscreen = () => {
      if (documentFullscreen) {
        Object.defineProperty(document, "fullscreenElement", documentFullscreen);
      } else {
        Reflect.deleteProperty(document, "fullscreenElement");
      }
      if (requestFullscreen) {
        Object.defineProperty(
          HTMLElement.prototype,
          "requestFullscreen",
          requestFullscreen,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
      }
      if (exitFullscreen) {
        Object.defineProperty(document, "exitFullscreen", exitFullscreen);
      } else {
        Reflect.deleteProperty(document, "exitFullscreen");
      }
      delete testWindow.__restoreAudioNotificationsFullscreen;
    };
  }, { facilityId: FIXTURE.facilityId });

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const payload = apiPayload(url.pathname);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __restoreAudioNotificationsFullscreen?: () => void;
    };
    testWindow.__restoreAudioNotificationsFullscreen?.();
  });
});

for (const path of monitorRoutes) {
  test(`keeps one audio control through fullscreen on ${path}`, async ({ page }) => {
    await page.goto(path);

    const enabled = page.getByRole("button", { name: "음성 안내 켜짐" });
    await expect(enabled).toHaveCount(1);
    await enabled.click();

    const disabled = page.getByRole("button", { name: "음성 안내 꺼짐" });
    await expect(disabled).toHaveCount(1);
    await disabled.click();
    await expect(page.getByRole("button", { name: "음성 안내 켜짐" })).toHaveCount(1);

    await page.getByRole("button", { name: "전체 화면", exact: true }).click();
    expect(await fullscreenAudioControlCount(page)).toBe(1);
    await expect(page.getByRole("button", { name: /^음성 안내 / })).toHaveCount(1);
  });
}

async function fullscreenAudioControlCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.fullscreenElement?.querySelectorAll(
        'button[aria-label^="음성 안내 "]',
      ).length ?? 0,
  );
}

function apiPayload(pathname: string): unknown {
  switch (pathname) {
    case "/api/v1/auth/me":
      return {
        id: "staff_audio_qa",
        email: "staff-audio-qa@example.test",
        nickname: "Audio QA Staff",
        role: "STAFF",
        facilityId: FIXTURE.facilityId,
      };
    case "/api/v1/facilities":
      return [facility()];
    case `/api/v1/facilities/${FIXTURE.facilityId}`:
      return facility();
    case "/api/v1/floors":
      return [
        {
          id: FIXTURE.floorId,
          facilityId: FIXTURE.facilityId,
          name: "2층",
          orderIndex: 2,
          provisioningSource: "PRODUCT",
        },
      ];
    case "/api/v1/spaces":
      return [
        {
          id: FIXTURE.spaceId,
          facilityId: FIXTURE.facilityId,
          floorId: FIXTURE.floorId,
          name: "201호",
          type: "ROOM",
          capacity: 2,
          isActive: true,
          provisioningSource: "PRODUCT",
        },
      ];
    case "/api/v1/alerts":
      return [];
    case "/api/v1/cameras":
      return [
        {
          id: "cam_201",
          facilityId: FIXTURE.facilityId,
          spaceId: FIXTURE.spaceId,
          online: true,
          lastSeenAt: "2099-01-01T00:00:00.000Z",
        },
      ];
    default:
      throw new Error(`Unexpected isolated API request: ${pathname}`);
  }
}

function facility() {
  return {
    id: FIXTURE.facilityId,
    name: "행복한 녹양 요양원",
    address: "",
    phone: "",
  };
}
