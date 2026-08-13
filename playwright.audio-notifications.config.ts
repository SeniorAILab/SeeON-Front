import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3000";
const target = new URL(baseURL);

if (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
  throw new Error("Audio notifications Playwright is restricted to an isolated local target.");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "audio-notifications.spec.ts",
  outputDir: "/tmp/seeon-audio-notifications-playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "desktop-1280x900",
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile-375x812",
      use: { viewport: { width: 375, height: 812 } },
    },
  ],
});
