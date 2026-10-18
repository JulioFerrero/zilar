import path from 'node:path';
import React from 'react';
import { render as renderInk } from 'ink';
import { OpencodeCliClient } from '../client.js';
import { loadGitCache, saveGitCache } from '../collect-snapshot.js';
import { RealGitRunner } from '../git.js';
import { findRepoRoot } from '../repo-root.js';
import { stateFilePath } from '../state.js';
import { buildView } from './collect.js';
import { formatClock } from './format.js';
import type { WatchView } from './view.js';

export const REFRESH_INTERVAL_MS = 10_000;

// One-shot `--data` mode: build the view once and print it as one JSON line.
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

// Renders the live Ink app in the alternate screen, restoring the terminal on exit. A
// resize listener ahead of Ink's clears the screen, so growing the window leaves no
// ghost lines; `--no-icons` falls back to plain characters.

// Runs before Ink's resize handler, which only clears when the window shrinks.
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
