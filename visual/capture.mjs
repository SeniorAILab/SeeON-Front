/**
 * 아침 승인용 현황판 스크린샷 캡처.
 *
 * 프로덕션에 접근하지 않고 로컬 dev 서버에서 두 상태를 찍는다.
 *   - mixed:    카메라 2대 LIVE / 5대 STALE (내일 아침 실제 구성, 2녹색 5회색)
 *   - all-live: 전부 LIVE (정상 상태 대조군)
 *   - panel:    위험한 방을 눌렀을 때의 조작면 (I4 확인/해결 완료 분리)
 *
 * 사용: node visual/capture.mjs <출력디렉터리>
 */
// playwright는 프로젝트 의존성이 아니라 npx 캐시에 있다.
// PLAYWRIGHT_PACKAGE로 경로를 넘기면 그걸 쓴다.
const pwPath = process.env.PLAYWRIGHT_PACKAGE ?? "playwright";
const { chromium } = await import(pwPath);
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const outDir = resolve(process.argv[2] ?? "./visual-out");
const BASE = "http://localhost:5199/visual/monitor-states.html";

await mkdir(outDir, { recursive: true });

// 브라우저 바이너리는 PLAYWRIGHT_CHROMIUM으로 지정할 수 있다.
// (npx 캐시의 playwright 버전과 다운로드된 빌드가 어긋날 때 사용)
const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
let browser;
try {
  browser = await chromium.launch(executablePath ? { executablePath } : {});
  // TV 벽면 기준 해상도. 4m 가독성을 이 크기에서 판단한다.
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
// 웨진 페이지가 무한대기하지 않고 크게 실패하도록 개별 호출에 명시된 타임아웃이 없는 대기/네비게이션 호출의 백스톱이다.
page.setDefaultTimeout(15000);

const results = [];
const actions = [];

for (const mode of ["mixed", "all-live", "panel", "system-test"]) {
  const url = `${BASE}?mode=${mode}`;
  await page.goto(url, { waitUntil: "networkidle" });
  actions.push({ type: "navigate", target: url, selector: "body", mode, timestamp: new Date().toISOString() });
  await page.waitForSelector('[data-testid="visual-root"]');
  await page.waitForSelector("[data-space-id]");
  actions.push({ type: "waitForSelector", target: "[data-space-id]", selector: "[data-space-id]", mode, timestamp: new Date().toISOString() });
  if (mode === "system-test") await page.waitForSelector('[data-test-mode="SYSTEM_TEST"]');

  const tiles = await page.$$eval("[data-space-id]", (nodes) =>
    nodes.map((n) => ({
      spaceId: n.getAttribute("data-space-id"),
      status: n.getAttribute("data-status"),
      connection: n.getAttribute("data-connection"),
      label: n.getAttribute("aria-label"),
    })),
  );

  const live = tiles.filter((t) => t.connection === "LIVE").length;
  const stale = tiles.filter((t) => t.connection === "STALE").length;
  const danger = tiles.filter((t) => t.status === "DANGER").length;
  const systemTests = await page.$$eval('[data-test-mode="SYSTEM_TEST"]', (nodes) =>
    nodes.map((node) => ({
      alertId: node.getAttribute("data-alert-id"),
      backendEventId: node.getAttribute("data-backend-event-id"),
      correlationId: node.getAttribute("data-correlation-id"),
      text: node.textContent,
    })),
  );

  const file = `${outDir}/monitor-${mode}.png`;
  // 요양보호사가 실제로 보는 것은 TV 화면 전체다. 보드 요소만 잘라 찍으면
  // 여백·배치·밀도를 승인할 수 없고, 승인한 화면과 배포된 화면이 달라진다.
  await page.screenshot({ path: file, fullPage: false });
  actions.push({ type: "screenshot", target: file, selector: "viewport:1920x1080", mode, timestamp: new Date().toISOString() });

  actions.push({
    type: "assert",
    target: "[data-connection]",
    selector: "[data-connection]",
    mode,
    result: { total: tiles.length, live, stale, danger },
    timestamp: new Date().toISOString(),
  });
  results.push({ mode, file, total: tiles.length, live, stale, danger, systemTests, tiles });
  console.log(`[${mode}] tiles=${tiles.length} live=${live} stale=${stale} danger=${danger} systemTests=${systemTests.length} -> ${file}`);
}

// browser는 아래 측정 전용 루프(overview-flow/focus-wall)에서도 쓰므로 오라클 판정 직후에는
// 닫지 않는다. 승인 네 모드의 스크린샷과 오라클 동작은 이 시점에 이미 모두 끝난 상태다.

// 게이트가 검증할 수 있도록 자동화 트랜스크립트를 JSON으로 남긴다.
const { writeFile } = await import("node:fs/promises");
await writeFile(
  `${outDir}/monitor-capture-transcript.json`,
  JSON.stringify(
    {
      schemaVersion: 1,
      tool: "playwright-chromium",
      viewport: { width: 1920, height: 1080 },
      capturedAt: new Date().toISOString(),
      oracle: { expect: { mixed: { live: 2, stale: 5 }, allLive: { stale: 0 } } },
      actions,
      runs: results,
    },
    null,
    2,
  ),
  "utf8",
);

// 오라클: mixed 모드는 정확히 2 LIVE / 5 STALE 이어야 한다.
// panel 모드는 조작면 승인용이라 타일 카운트 오라클 대상이 아니다.
const mixed = results.find((r) => r.mode === "mixed");
if (mixed.live !== 2 || mixed.stale !== 5) {
  console.error(`ORACLE FAIL: expected 2 live / 5 stale, got ${mixed.live}/${mixed.stale}`);
  throw new Error("Legacy mixed oracle failed");
}
const allLive = results.find((r) => r.mode === "all-live");
if (allLive.stale !== 0) {
  console.error(`ORACLE FAIL: all-live expected 0 stale, got ${allLive.stale}`);
  throw new Error("Legacy all-live oracle failed");
}
const systemTest = results.find((r) => r.mode === "system-test");
if (
  systemTest.systemTests.length !== 1 ||
  !systemTest.systemTests[0].alertId ||
  systemTest.systemTests[0].backendEventId !== systemTest.systemTests[0].correlationId ||
  !systemTest.systemTests[0].text.includes("SYSTEM TEST")
) {
  console.error("ORACLE FAIL: SYSTEM TEST presentation/correlation marker missing");
  throw new Error("Legacy system-test oracle failed");
}
console.log("ORACLE PASS: mixed=2 live/5 stale, all-live=0 stale, system-test=1 correlated marker");

// =============================================================================
// 측정 전용 루프 (승인 대상 아님): overview-flow / focus-wall
//
// 위 승인 네 모드와 달리 스크린샷을 찍지 않고 legacy approval oracle에도
// 이 결과를 넣지 않는다. jsdom은 스타일시트를 로드하지 않고 레이아웃도 수행하지
// 않으므로, .page-grid/.page-bleed CSS와 높이 체인이 실제로 작동함을 증명하는
// 유일한 증거가 이 루프다. 값을 부드럽게 맞춰주지 않는다 - 실패하면 실패한 숫자를
// 그대로 출력하고 종료 코드 1로 끝난다.
// =============================================================================

const NAV_TIMEOUT_MS = 15000;
const ASSERT_TIMEOUT_MS = 5000;
const measurements = {};
let measureFailed = false;

function record(key, value, pass) {
  measurements[key] = value;
  const mark = pass ? "PASS" : "FAIL";
  console.log(`[measure:${key}] ${JSON.stringify(value)} -> ${mark}`);
  if (!pass) measureFailed = true;
}

async function findScrollOwners() {
  return page.$eval('section[aria-label="방 상태 보드"]', (el) => {
    const bad = [];
    for (const node of [el, ...el.querySelectorAll("*")]) {
      const style = getComputedStyle(node);
      const computed = {
        overflow: style.overflow,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      };
      if (Object.values(computed).some((value) => value === "auto" || value === "scroll")) {
        bad.push({ node: node.tagName, ...computed });
      }
    }
    return bad;
  });
}

// ---- focus-wall -------------------------------------------------------------
{
  const url = `${BASE}?mode=focus-wall`;
  await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
  await page.waitForSelector('[data-testid="visual-root"]', { timeout: ASSERT_TIMEOUT_MS });
  await page.waitForSelector('section[aria-label="방 상태 보드"]', { timeout: ASSERT_TIMEOUT_MS });
  await page.waitForSelector("[data-space-id]", { timeout: ASSERT_TIMEOUT_MS });

  const box = await page.$eval(
    'section[aria-label="방 상태 보드"]',
    (el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }),
  );
  record("focus-wall.a_scrollHeight_le_clientHeight", box, box.scrollHeight <= box.clientHeight);
  record("focus-wall.b_clientHeight_ge_900", box, box.clientHeight >= 900);

  // c) 실제 DOM에서 컨테이너가 남긴 높이를 보드가 모두 채우는지도 별도로 확인한다.
  // 헤더/보드 사이의 flex 높이 체인이 끊기는 회귀를 잡는다.
  const fill = await page.$eval('section[aria-label="방 상태 보드"]', (boardEl) => {
    const root = document.querySelector('[data-testid="visual-root"]');
    const header = root.querySelector("header") ?? root.children[0];
    const rootRect = root.getBoundingClientRect();
    const rootStyle = getComputedStyle(root);
    const rootPaddingTop = parseFloat(rootStyle.paddingTop);
    const rootPaddingBottom = parseFloat(rootStyle.paddingBottom);
    const containerInnerHeight = rootRect.height - rootPaddingTop - rootPaddingBottom;
    const headerRect = header.getBoundingClientRect();
    const boardRect = boardEl.getBoundingClientRect();
    // 헤더 아래쪽 끝에서 보드 위쪽 끝까지의 실측 간격 - mt-4 gap을 하드코딩하지 않고
    // 두 실제 rect의 차이로 구한다.
    const gapBetweenHeaderAndBoard = boardRect.top - headerRect.bottom;
    const expectedBoardHeight = containerInnerHeight - headerRect.height - gapBetweenHeaderAndBoard;
    const actualBoardHeight = boardRect.height;
    return {
      containerHeight: rootRect.height,
      rootPaddingTop,
      rootPaddingBottom,
      containerInnerHeight,
      headerHeight: headerRect.height,
      gapBetweenHeaderAndBoard,
      expectedBoardHeight,
      actualBoardHeight,
      delta: actualBoardHeight - expectedBoardHeight,
    };
  });
  const FILL_TOLERANCE_PX = 2;
  record(
    "focus-wall.b_board_fills_container_remainder",
    fill,
    Math.abs(fill.delta) <= FILL_TOLERANCE_PX,
  );
  const tileCount = await page.$$eval("[data-space-id]", (nodes) => nodes.length);
  const expectedFocusWallRooms = 7; // visual/monitor-states.tsx 의 `spaces` 고정 피쳐링 방 수 (mixed/focus-wall 공유)
  record("focus-wall.c_tileCount", { actual: tileCount, expected: expectedFocusWallRooms }, tileCount === expectedFocusWallRooms);

  const overflowingDescendants = await findScrollOwners();
  record("focus-wall.d_overflow_auto_or_scroll_root_or_descendants", overflowingDescendants, overflowingDescendants.length === 0);
}

// ---- overview-flow ------------------------------------------------------------
{
  const url = `${BASE}?mode=overview-flow`;
  await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
  await page.waitForSelector('[data-testid="visual-root"]', { timeout: ASSERT_TIMEOUT_MS });
  await page.waitForSelector('section[aria-label="방 상태 보드"]', { timeout: ASSERT_TIMEOUT_MS });
  await page.waitForSelector("[data-space-id]", { timeout: ASSERT_TIMEOUT_MS });

  const overflowingDescendants = await findScrollOwners();
  record("overview-flow.e_overflow_auto_or_scroll_root_or_descendants", overflowingDescendants, overflowingDescendants.length === 0);

  const docMetrics = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement.scrollHeight,
    scrollWidth: document.scrollingElement.scrollWidth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));
  record(
    "overview-flow.f_documentScrollHeight_gt_innerHeight",
    docMetrics,
    docMetrics.scrollHeight > docMetrics.innerHeight,
  );
  record(
    "overview-flow.g_documentScrollWidth_le_innerWidth",
    docMetrics,
    docMetrics.scrollWidth <= docMetrics.innerWidth,
  );

  // CSS-트랙 검사: 실제 monitor root는 page-grid의 직접 자식이며 page-bleed를 가진다.
  const trackStyles = await page.evaluate(() => {
    const normal = document.querySelector('[data-testid="css-track-normal"]');
    const monitorRoot = document.querySelector('[data-testid="visual-root"]');
    return {
      normalGridColumnStart: getComputedStyle(normal).gridColumnStart,
      monitorRootGridColumnStart: getComputedStyle(monitorRoot).gridColumnStart,
    };
  });
  record(
    "css-track.monitor_root_bleed_vs_normal_gridColumnStart",
    trackStyles,
    trackStyles.normalGridColumnStart === "2" && trackStyles.monitorRootGridColumnStart === "1",
  );

  // 모달 검사: 문서를 아래로 스크롤한 다음 방 타일을 클릭해 RoomActionPanel을 열고,
  // 그 범위가 뷰포트 안에 있는지 확인한다(fixed inset-0이므로 리지션 문제를 가장 잘 드러낸다).
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => window.scrollY > 0, undefined, { timeout: ASSERT_TIMEOUT_MS });
  const scrollYAfter = await page.evaluate(() => window.scrollY);

  const firstTile = await page.$("[data-space-id]");
  await firstTile.click({ timeout: ASSERT_TIMEOUT_MS });
  await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: ASSERT_TIMEOUT_MS });
  const modalRect = await page.$eval('[role="dialog"][aria-modal="true"]', (el) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  });
  record(
    "overview-flow.modal_rect_within_viewport",
    { scrollYAfter, ...modalRect },
    modalRect.top >= 0 && modalRect.bottom <= 1080,
  );
}

// ---- route-grid -------------------------------------------------------------
// The track proof must use the actual StaffLayout -> Outlet -> FloorMonitorPage tree.
// The normal sibling is rendered by that Outlet too, so both are direct children of StaffLayout's real main.page-grid.
{
  const url = `${BASE}?mode=route-grid`;
  await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
  await page.waitForSelector('[data-testid="monitor-root"]', { timeout: ASSERT_TIMEOUT_MS });
  await page.waitForSelector('[data-testid="monitor-surface"]', { timeout: ASSERT_TIMEOUT_MS });
  await page.waitForSelector('[data-testid="route-grid-normal"]', { timeout: ASSERT_TIMEOUT_MS });
  await page.waitForSelector('section[aria-label="방 상태 보드"] [data-space-id]', { timeout: ASSERT_TIMEOUT_MS });

  const routeGrid = await page.evaluate(() => {
    const main = document.querySelector("main.page-grid");
    const monitorRoot = document.querySelector('[data-testid="monitor-root"]');
    const normal = document.querySelector('[data-testid="route-grid-normal"]');
    return {
      mainExists: main !== null,
      mainTag: main?.tagName ?? null,
      mainClass: main?.className ?? null,
      monitorRootIsDirectMainChild: monitorRoot?.parentElement === main,
      normalIsDirectMainChild: normal?.parentElement === main,
      monitorRootGridColumnStart: monitorRoot ? getComputedStyle(monitorRoot).gridColumnStart : null,
      normalGridColumnStart: normal ? getComputedStyle(normal).gridColumnStart : null,
    };
  });
  record(
    "route-grid.actual_StaffLayout_Outlet_FloorMonitorPage_tracks",
    routeGrid,
    routeGrid.mainExists &&
      routeGrid.monitorRootIsDirectMainChild &&
      routeGrid.normalIsDirectMainChild &&
      routeGrid.monitorRootGridColumnStart === "1" &&
      routeGrid.normalGridColumnStart === "2",
  );
}

await writeFile(`${outDir}/measure-transcript.json`, JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), measurements }, null, 2), "utf8");

if (measureFailed) {
  console.error("MEASURE FAIL: one or more geometry assertions failed - see [measure:*] lines above");
  throw new Error("Geometry assertions failed");
}
console.log("MEASURE PASS: all focus-wall/overview-flow/css-track/modal assertions held");
} finally {
  if (browser) {
    await browser.close();
    console.log("BROWSER CLOSED: Chromium lifecycle completed");
  }
}
