// The `lead watch` entry points: the one-shot `--data` child process and the
// live Ink app. Moved unchanged from `lead/watch.ts` (size split).

import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render as renderInk } from 'ink';
import { OpencodeCliClient } from '../client.js';
import { loadGitCache, saveGitCache } from '../collect-snapshot.js';
import { RealGitRunner } from '../git.js';
import { stateFilePath } from '../state.js';
import { buildView } from './collect.js';
import { formatClock } from './format.js';
import type { WatchView } from './view.js';

export const REFRESH_INTERVAL_MS = 10_000;

function findRepoRoot(): string {
  let dir = path.resolve(process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, 'work', 'BOARD.md'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('not inside a Zilar checkout (no work/BOARD.md above the cwd)');
    }
    dir = parent;
  }
}

// One-shot mode used by the watcher's child process: build the view once
// and print it as a single JSON line. Hidden `--data` flag on `lead watch`.
export async function runWatchData(): Promise<void> {
  const root = findRepoRoot();
  const statePath = stateFilePath();
  const cachePath = path.join(path.dirname(statePath), 'watch-cache.json');
  const gitCache = loadGitCache(cachePath);
  const view = await buildView(
    { clock: formatClock(new Date()), refreshFailed: false, mergedToday: 0, entries: [] },
    root,
    statePath,
    new OpencodeCliClient(),
    new RealGitRunner(),
    gitCache,
    Date.now(),
  );
  saveGitCache(cachePath, gitCache);
  process.stdout.write(`${JSON.stringify(view)}\n`);
}

// Renders the live Ink app (`WatchLive` in `watch-app.tsx` owns the refresh
// loop, the clock and the quit keys). Ink draws in the terminal's alternate
// screen and restores the terminal when the app exits; a resize listener
// ahead of Ink's own clears the whole screen, so growing the window never
// leaves ghost lines behind. The app module is
// imported lazily so `watch.ts` stays free of a render-time import cycle.
// `lead watch --no-icons` (or `ZILAR_WATCH_ICONS=0`) falls back to plain
// characters instead of the Nerd Font glyphs.

// Clears the whole screen and homes the cursor, then asks Ink to redraw
// from a clean slate. Runs before Ink's own resize handler, which only
// clears when the window shrinks.
export function fullClearOnResize(out: { write(s: string): unknown }, clear: () => void): void {
  const esc = String.fromCharCode(27);
  out.write(`${esc}[2J${esc}[H`);
  clear();
}

export async function runWatch(options?: { noIcons?: boolean }): Promise<void> {
  const { iconsEnabled } = await import('../watch-format.js');
  const { WatchLive } = await import('../watch-app.js');
  const initial: WatchView = {
    clock: formatClock(new Date()),
    refreshFailed: false,
    mergedToday: 0,
    entries: [],
  };
  const app = renderInk(
    React.createElement(WatchLive, { initial, icons: iconsEnabled(options?.noIcons ?? false) }),
    { alternateScreen: true },
  );
  const onResize = (): void => fullClearOnResize(process.stdout, () => app.clear());
  process.stdout.prependListener('resize', onResize);
  try {
    await app.waitUntilExit();
  } finally {
    process.stdout.removeListener('resize', onResize);
  }
}
