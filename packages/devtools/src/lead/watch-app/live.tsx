// `WatchLive`: the live shell around `WatchApp`. Moved unchanged from
// `lead/watch-app.tsx` (size split).

import { execFile } from 'node:child_process';
import { useApp, useInput, useStdin, useStdout } from 'ink';
import { useEffect, useState, type ReactNode } from 'react';
import { iconsEnabled, layoutColumns, visibleSlice } from '../watch-format.js';
import { formatClock, parseWatchView, REFRESH_INTERVAL_MS } from '../watch.js';
import type { WatchView } from '../watch.js';
import { HEADER_ROWS, rowHeights, rowsOf } from './segments.js';
import { WatchApp } from './view.js';

// The live shell around `WatchApp`: refreshes the view every 3 seconds from
// a `lead watch --data` child process (its synchronous git/OpenCode calls
// never block the animation), ticks the clock every second, and quits
// cleanly on `q` or Ctrl-C through Ink, which restores the terminal.
export function WatchLive({ initial, icons }: { initial: WatchView; icons?: boolean }): ReactNode {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { stdout: term } = useStdout();
  const [view, setView] = useState<WatchView>(initial);
  const [updatedAt, setUpdatedAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  const [scroll, setScroll] = useState<number>(0);

  const ttyColumns = (term as { columns?: unknown }).columns;
  const width = Math.max(20, Math.floor(typeof ttyColumns === 'number' ? ttyColumns : 80));
  const ttyRows = (term as { rows?: unknown }).rows;
  const knownRows = typeof ttyRows === 'number' ? Math.floor(ttyRows) : undefined;
  const columnCount = knownRows === undefined ? 1 : layoutColumns(width);
  const cardRows = rowsOf(view.entries, columnCount);
  const totalRows = cardRows.length;
  const maxOffset = Math.max(0, totalRows - 1);
  const availableRows =
    knownRows === undefined ? Number.POSITIVE_INFINITY : Math.max(0, knownRows - HEADER_ROWS - 1);
  // Entries, columns or rows can change under us: clamp while rendering so the
  // offset never points past the end.
  const scrollOffset = Math.min(scroll, maxOffset);
  const slice = visibleSlice(rowHeights(cardRows), scrollOffset, availableRows);
  const pageRows = Math.max(1, slice.end - slice.start);

  const move = (delta: number): void => {
    setScroll((current) => Math.min(Math.max(0, current + delta), maxOffset));
  };

  useInput(
    (input, key) => {
      if (input === 'q' || input === 'Q' || (key.ctrl && (input === 'c' || input === 'C'))) {
        exit();
        return;
      }
      if (key.upArrow || input === 'k') {
        move(-1);
        return;
      }
      if (key.downArrow || input === 'j') {
        move(1);
        return;
      }
      if (key.pageUp || input === 'u') {
        move(-pageRows);
        return;
      }
      if (key.pageDown || input === 'd') {
        move(pageRows);
        return;
      }
      if (key.home || input === 'g') {
        setScroll(0);
        return;
      }
      if (key.end || input === 'G') {
        setScroll(maxOffset);
      }
    },
    { isActive: isRawModeSupported },
  );

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const scriptArg = process.argv[1];
    const dataArgs =
      scriptArg === undefined ? null : [...process.execArgv, scriptArg, 'watch', '--data'];
    const refresh = (): void => {
      if (dataArgs === null || inFlight) {
        return;
      }
      inFlight = true;
      execFile(
        process.execPath,
        dataArgs,
        { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 },
        (error, stdout) => {
          inFlight = false;
          if (cancelled) {
            return;
          }
          if (error !== null) {
            setView((previous) => ({ ...previous, refreshFailed: true }));
            return;
          }
          const lastLine = stdout.trim().split('\n').at(-1) ?? '';
          const parsed = parseWatchView(lastLine);
          if (parsed === null) {
            setView((previous) => ({ ...previous, refreshFailed: true }));
            return;
          }
          setView(parsed);
          setUpdatedAt(Date.now());
        },
      );
    };
    refresh();
    const refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
    const clockTimer = setInterval(() => {
      if (!cancelled) {
        setNow(Date.now());
      }
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
      clearInterval(clockTimer);
    };
  }, []);

  return (
    <WatchApp
      view={view}
      updatedAgoSecs={(now - updatedAt) / 1000}
      clock={formatClock(new Date(now))}
      icons={icons ?? iconsEnabled(false)}
      scroll={scrollOffset}
    />
  );
}
