// effect-plain: dev screenshot script, not shipped
/**
 * Regenerates every screenshot in `docs/screenshots/` (T-0131).
 *
 * The script starts the web app's dev server on a spare loopback port, drives
 * it with headless Chromium in `?mock=1` mode (dev builds only; no real
 * server, account or network), and captures each shot at a fixed viewport.
 * Run it with: `pnpm screenshots` from the repo root.
 *
 * Requirements: `playwright` (root devDependency) with its Chromium build
 * installed (`pnpm exec playwright install chromium`). No browser binaries
 * are committed.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = join(root, 'docs', 'screenshots');

// Playwright and effect live in workspace packages, not at the root, so
// resolve them from the web app like the app's own tooling does. The shot
// table lives in `./shots.ts` (side-effect free, so tests can import it
// too); the Effect `Schema` module is injected into it here.
const requireFromWeb = createRequire(join(root, 'apps', 'web', 'package.json'));
const { chromium } = requireFromWeb('playwright') as typeof import('playwright');
const { Schema } = requireFromWeb('effect') as typeof import('effect');
import type { Shot } from './shots.ts';
import { shotTable } from './shots.ts';
type Browser = import('playwright').Browser;
type Page = import('playwright').Page;

/** A spare loopback port. Never 3000, 5173, 8081 or 3188. */
const PORT = 4319;
const BASE = `http://localhost:${PORT}`;

/** PNGs must stay under 400 KB (task checks). */
const MAX_PNG_BYTES = 400 * 1024;

async function waitForServer(url: string, tries = 60): Promise<void> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The dev server is still starting; keep waiting.
    }
    await delay(500);
  }
  throw new Error(`The dev server never came up at ${url}`);
}

function startDevServer(onError: (error: Error) => void): ReturnType<typeof spawn> {
  const child = spawn(
    'pnpm',
    ['--filter', '@zilar/web', 'exec', 'vite', '--port', String(PORT), '--strictPort'],
    {
      cwd: root,
      stdio: 'ignore',
    },
  );
  // A spawn failure (missing binary, bad cwd) must reject the startup wait
  // instead of escaping as an uncaught exception from the event handler.
  child.on('error', onError);
  return child;
}

async function stopDevServer(child: ReturnType<typeof spawn>): Promise<void> {
  child.kill('SIGTERM');
  await delay(1000);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

/**
 * One named interaction per shot that needs it. Each arm waits for the app
 * to settle first; the caller screenshots after this returns.
 */
async function runSetup(page: Page, setup: string): Promise<void> {
  switch (setup) {
    case 'none':
      return;
    // Keep the query at two characters: the mock backend has no people-search
    // route (`apps/web/src/lib/api/people.ts:60` calls `/users/search`, which
    // `contact-requests/routes.ts` does not serve), so a 3+ character query
    // would paint a mock-only "Could not search." error into the shot.
    case 'searchMessages':
      await page.locator('#chat-search').fill('ti');
      await page.waitForTimeout(1500);
      return;
    case 'openChatMenu':
      await page.getByRole('button', { name: 'Chat menu' }).click();
      await page.waitForTimeout(600);
      return;
    case 'openNewTopic':
      // The row's new-topic button is hover-only and the group header button
      // sits over it, so dispatch the click directly (like `openToolDetail`).
      await page.waitForSelector('button[aria-label="New topic in Dev team"]', { timeout: 15000 });
      await page.$eval('button[aria-label="New topic in Dev team"]', (button) => button.click());
      await page.waitForTimeout(800);
      return;
    // T-0107: the topic panel opens from the URL already (`?panel=topic`);
    // click the first tool row so the shot shows the detail (source,
    // history, run) instead of the list. The panel covers the chat, so
    // dispatch the click directly instead of Playwright's actionability
    //-checked `click()` (the dialog backdrop never intercepts it). The
    // panel needs a beat after the 7 s settle: the tools list loads over
    // the mock API.
    case 'openToolDetail':
      await page.waitForSelector('button[aria-label="Open prices"]', { timeout: 15000 });
      await page.$eval('button[aria-label="Open prices"]', (button) => button.click());
      await page.waitForTimeout(1500);
      // A focused element paints a text caret in the panel title; blur it
      // before the capture.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      return;
    // T-0107: the group panel opens from the URL already (`?panel=group`);
    // scroll the routines section into view so the shot shows the routine
    // rows instead of the top of the panel.
    case 'openRoutines': {
      await page.waitForSelector('section[aria-label="Routines"]', { timeout: 15000 });
      await page.$eval('section[aria-label="Routines"]', (section) =>
        section.scrollIntoView({ block: 'start' }),
      );
      await page.waitForTimeout(800);
      // A focused element paints a text caret in the panel title; blur it
      // before the capture.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      return;
    }
    // WUX-29: a right-click on a message opens its actions menu at the
    // pointer. The last message is the newest visible one.
    case 'openMessageMenu': {
      const target = page.locator('[data-message-id]').last();
      await target.click({ button: 'right' });
      await page.waitForTimeout(600);
      return;
    }
    // The pins arrive from the mock API after the chat opens; wait for the
    // banner so the shot never races and misses it.
    case 'waitPins': {
      await page.waitForSelector('[aria-label^="Jump to pinned message"]', { timeout: 15000 });
      await page.waitForTimeout(400);
      return;
    }
    default:
      throw new Error(`Unknown screenshot setup: ${setup}`);
  }
}

async function capture(browser: Browser, dir: string, shot: Shot): Promise<void> {
  const context = await browser.newContext({ viewport: shot.viewport });
  const page = await context.newPage();
  // Mock mode only: the dev build serves fake chats locally, so no real
  // request ever leaves the machine (the mock API answers in memory). Every
  // shot carries `mock=1`, except `/login`: mock mode reports the viewer as
  // already signed in (`AuthProvider.tsx` MockAuthProvider), so `/login`
  // redirects home. The sign-in shot instead runs the live auth path with the
  // session endpoint answered locally as "no session" (401), which is exactly
  // what a real signed-out browser gets, and no request leaves the machine.
  // Match only the real `/api/*` paths: `**/api/**` would also swallow the
  // dev server's own `/src/lib/api/*.ts` module requests and blank the app.
  const isLogin = shot.path === '/login';
  if (isLogin) {
    await context.route(
      (url) => url.pathname.startsWith('/api/'),
      (route) =>
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: '{"message":"no session"}',
        }),
    );
  }
  const separator = shot.path.includes('?') ? '&' : '?';
  const url = isLogin ? `${BASE}${shot.path}` : `${BASE}${shot.path}${separator}mock=1`;
  await page.goto(url, { waitUntil: 'networkidle' });
  // Past the mock API delay, the typing simulation and the search debounce.
  await page.waitForTimeout(7000);
  await runSetup(page, shot.setup);
  await page.screenshot({
    path: join(dir, shot.name),
    animations: 'disabled',
  });
  await context.close();
}

function checkSizes(dir: string, shots: Shot[]): void {
  const oversized = shots
    .map((shot) => ({ name: shot.name, bytes: statSync(join(dir, shot.name)).size }))
    .filter((entry) => entry.bytes > MAX_PNG_BYTES);
  if (oversized.length > 0) {
    throw new Error(
      `Screenshots over 400 KB: ${oversized.map((entry) => `${entry.name} (${Math.round(entry.bytes / 1024)} KB)`).join(', ')}`,
    );
  }
}

async function main(): Promise<void> {
  const shots = shotTable(Schema);
  // Capture into a temp dir first: a mid-run failure must never leave a
  // half-fresh set in `docs/screenshots/`. Only a complete run swaps in.
  const staging = mkdtempSync(join(tmpdir(), 'zilar-screenshots-'));
  let server: ReturnType<typeof spawn> | undefined;
  let serverError: Error | undefined;
  try {
    server = startDevServer((error) => {
      serverError = error;
    });
    await waitForServer(`${BASE}/`);
    if (serverError !== undefined) {
      throw serverError;
    }
    const browser = await chromium.launch();
    try {
      for (const shot of shots) {
        await capture(browser, staging, shot);
        console.log(`captured ${shot.name}`);
      }
    } finally {
      await browser.close();
    }
    checkSizes(staging, shots);
    mkdirSync(outDir, { recursive: true });
    for (const shot of shots) {
      renameSync(join(staging, shot.name), join(outDir, shot.name));
    }
    console.log(`All ${shots.length} screenshots are under 400 KB.`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
    if (server !== undefined) {
      await stopDevServer(server);
    }
  }
}

await main();
