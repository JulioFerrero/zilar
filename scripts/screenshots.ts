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

// Playwright and zod live in workspace packages, not at the root, so resolve
// them from the web app like the app's own tooling does.
const requireFromWeb = createRequire(join(root, 'apps', 'web', 'package.json'));
const { chromium } = requireFromWeb('playwright') as typeof import('playwright');
const zod = requireFromWeb('zod') as typeof import('zod');
type Browser = import('playwright').Browser;
type Page = import('playwright').Page;

/** A spare loopback port. Never 3000, 5173, 8081 or 3188. */
const PORT = 4319;
const BASE = `http://localhost:${PORT}`;

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** PNGs must stay under 400 KB (task checks). */
const MAX_PNG_BYTES = 400 * 1024;

const shotSchema = zod.object({
  name: zod.string(),
  path: zod.string(),
  viewport: zod.object({ width: zod.number(), height: zod.number() }),
  setup: zod.string(),
});

interface Shot {
  name: string;
  path: string;
  viewport: { width: number; height: number };
  setup: string;
}

interface ShotDef {
  /** File name under `docs/screenshots/`. */
  name: string;
  /** Path after {@link BASE} (mock query appended automatically). */
  path: string;
  viewport: { width: number; height: number };
  /**
   * Named setup, implemented in {@link runSetup}. Keeps the shot table
   * serializable so it can be validated with zod.
   */
  setup: string;
}

const DESKTOP_SHOTS: ShotDef[] = [
  { name: 'signin-desktop.png', path: '/login', viewport: DESKTOP, setup: 'none' },
  { name: 'topics-desktop.png', path: '/', viewport: DESKTOP, setup: 'none' },
  { name: 'topic-desktop.png', path: '/c/c-devteam-bug', viewport: DESKTOP, setup: 'none' },
  { name: 'group-desktop.png', path: '/c/c-qa?panel=group', viewport: DESKTOP, setup: 'none' },
  {
    name: 'approval-desktop.png',
    path: '/settings/approvals',
    viewport: DESKTOP,
    setup: 'none',
  },
  { name: 'search-desktop.png', path: '/c/c-ana', viewport: DESKTOP, setup: 'searchTickets' },
  { name: 'pins-desktop.png', path: '/c/c-ana', viewport: DESKTOP, setup: 'none' },
  { name: 'prefs-desktop.png', path: '/c/c-ana', viewport: DESKTOP, setup: 'openChatMenu' },
  { name: 'newtopic-desktop.png', path: '/', viewport: DESKTOP, setup: 'openNewTopic' },
  {
    name: 'aisettings-desktop.png',
    path: '/c/c-devai?panel=ai',
    viewport: DESKTOP,
    setup: 'none',
  },
  { name: 'machines-desktop.png', path: '/settings/machines', viewport: DESKTOP, setup: 'none' },
];

const PHONE_SHOTS: ShotDef[] = [
  { name: 'topics-phone.png', path: '/', viewport: PHONE, setup: 'none' },
  { name: 'topic-phone.png', path: '/c/c-devteam-bug', viewport: PHONE, setup: 'none' },
  { name: 'chat-phone.png', path: '/c/c-ana', viewport: PHONE, setup: 'none' },
  // The search box lives in the list pane, which a phone hides while a chat
  // is open — so the phone search shot starts from the list.
  { name: 'search-phone.png', path: '/', viewport: PHONE, setup: 'searchTickets' },
];

/** Every shot as plain data, validated before the browser even starts. */
function shotTable(): Shot[] {
  return shotSchema.array().parse([...DESKTOP_SHOTS, ...PHONE_SHOTS]) as Shot[];
}

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
    ['--filter', '@galena/web', 'exec', 'vite', '--port', String(PORT), '--strictPort'],
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
    case 'searchTickets':
      await page.locator('#chat-search').fill('tickets');
      await page.waitForTimeout(1500);
      return;
    case 'openChatMenu':
      await page.getByRole('button', { name: 'Chat menu' }).click();
      await page.waitForTimeout(600);
      return;
    case 'openNewTopic':
      await page.getByRole('button', { name: 'New topic in Dev team' }).click();
      await page.waitForTimeout(800);
      return;
    default:
      throw new Error(`Unknown screenshot setup: ${setup}`);
  }
}

async function capture(browser: Browser, dir: string, shot: Shot): Promise<void> {
  const context = await browser.newContext({ viewport: shot.viewport });
  const page = await context.newPage();
  // Mock mode only: the dev build serves fake chats locally, so no real
  // request ever leaves the machine (the mock API answers in memory).
  // Every shot carries `mock=1`, including `/login` (the dev build renders
  // the email form without a session; mock mode only skips the auth gate).
  const separator = shot.path.includes('?') ? '&' : '?';
  await page.goto(`${BASE}${shot.path}${separator}mock=1`, { waitUntil: 'networkidle' });
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
  const shots = shotTable();
  // Capture into a temp dir first: a mid-run failure must never leave a
  // half-fresh set in `docs/screenshots/`. Only a complete run swaps in.
  const staging = mkdtempSync(join(tmpdir(), 'galena-screenshots-'));
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
