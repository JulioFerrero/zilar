// `lead watch` as a proper terminal app, rendered with Ink. `WatchApp` is
// pure (view plus refresh state in, terminal lines out) so tests render it
// with `ink-testing-library`; `WatchLive` owns the 3-second child-process
// refresh, the clock ticker and the quit keys.

import { Box, Text, useAnimation, useApp, useInput, useStdin, useStdout } from 'ink';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { useEffect, useState, type ReactNode } from 'react';
import {
  formatClock,
  formatContext,
  formatDuration,
  parseWatchView,
  REFRESH_INTERVAL_MS,
  sparkline,
} from './watch.js';
import type { ChangedFile, SessionSpeed, WatchEntry, WatchView } from './watch.js';
import {
  COMPACT_WIDTH,
  contextColorName,
  iconsEnabled,
  iconText,
  liveStepIcon,
  modelBadge,
  phaseColorName,
  SPINNER_FRAMES,
  trackerStep,
  truncate,
  type ModelBadge,
} from './watch-format.js';

interface Seg {
  text: string;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
}

interface Border {
  color?: string;
  dimColor?: boolean;
}

function segLen(segs: Seg[]): number {
  return segs.reduce((sum, seg) => sum + Array.from(seg.text).length, 0);
}

// Cut segments to `width` on their plain concatenation. Styles past the cut
// are dropped, so callers fit the parts they care about before joining.
function truncateSegs(segs: Seg[], width: number): Seg[] {
  const plain = segs.map((seg) => seg.text).join('');
  if (Array.from(plain).length <= width) {
    return segs;
  }
  const cut: Seg = { text: truncate(plain, width) };
  const first = segs[0];
  if (first?.color !== undefined) {
    cut.color = first.color;
  }
  if (first?.bold !== undefined) {
    cut.bold = first.bold;
  }
  if (first?.dimColor !== undefined) {
    cut.dimColor = first.dimColor;
  }
  return [cut];
}

function borderSeg(text: string, border: Border): Seg {
  const seg: Seg = { text };
  if (border.color !== undefined) {
    seg.color = border.color;
  }
  if (border.dimColor !== undefined) {
    seg.dimColor = border.dimColor;
  }
  return seg;
}

function Line({ segs }: { segs: Seg[] }): ReactNode {
  return (
    <Text>
      {segs.map((seg, index) => {
        const props: { color?: string; bold?: boolean; dimColor?: boolean } = {};
        if (seg.color !== undefined) {
          props.color = seg.color;
        }
        if (seg.bold !== undefined) {
          props.bold = seg.bold;
        }
        if (seg.dimColor !== undefined) {
          props.dimColor = seg.dimColor;
        }
        return (
          <Text key={index} {...props}>
            {seg.text}
          </Text>
        );
      })}
    </Text>
  );
}

// `╭─ left ─── right ─╮` sized to exactly `width`, labels truncated first.
function topBorder(left: Seg[], right: Seg[], width: number, border: Border): Seg[] {
  let shownLeft = left;
  let shownRight = right;
  let dashes = width - 8 - segLen(shownLeft) - segLen(shownRight);
  if (dashes < 1) {
    shownRight = truncateSegs(right, Math.max(1, width - 9 - segLen(shownLeft)));
    dashes = width - 8 - segLen(shownLeft) - segLen(shownRight);
  }
  if (dashes < 1) {
    shownLeft = truncateSegs(left, Math.max(1, width - 9 - segLen(shownRight)));
    dashes = width - 8 - segLen(shownLeft) - segLen(shownRight);
  }
  if (dashes < 1) {
    dashes = 1;
  }
  return [
    borderSeg('╭─ ', border),
    ...shownLeft,
    { text: ' ' },
    borderSeg('─'.repeat(dashes), border),
    { text: ' ' },
    ...shownRight,
    borderSeg(' ─╮', border),
  ];
}

function plainTop(width: number, border: Border): Seg[] {
  return [borderSeg(`╭${'─'.repeat(Math.max(0, width - 2))}╮`, border)];
}

function bottom(width: number, border: Border): Seg[] {
  return [borderSeg(`╰${'─'.repeat(Math.max(0, width - 2))}╯`, border)];
}

function bodyLine(content: Seg[], width: number, border: Border): Seg[] {
  const inner = width - 3;
  const cut = truncateSegs(content, inner);
  const pad = ' '.repeat(Math.max(0, inner - segLen(cut)));
  return [borderSeg('│ ', border), ...cut, { text: pad }, borderSeg('│', border)];
}

export function badgeSegs(badge: ModelBadge): Seg[] {
  const segs: Seg[] =
    badge.color === undefined ? [{ text: badge.name }] : [{ text: badge.name, color: badge.color }];
  if (badge.effort !== undefined) {
    segs.push({ text: ` · ${badge.effort}`, dimColor: true });
  }
  if (badge.free) {
    segs.push({ text: ' free', color: 'green' });
  }
  return segs;
}

export function ModelBadge({
  model,
  effort,
}: {
  model: string;
  effort: string | undefined;
}): ReactNode {
  const badge = modelBadge(model, effort);
  return <Line segs={badgeSegs(badge)} />;
}

function trackerSegs(entry: WatchEntry, compact: boolean, inner: number): Seg[] {
  const step = trackerStep(entry.phaseId);
  const color = phaseColorName(entry.phaseId);
  const dots: Seg[] = [];
  for (let i = 1; i <= 4; i += 1) {
    if (i > 1) {
      if (compact) {
        dots.push({ text: ' ' });
      } else if (i - 1 < step) {
        dots.push({ text: '━'.repeat(5), color });
      } else {
        dots.push({ text: '━'.repeat(5), dimColor: true });
      }
    }
    if (i < step) {
      dots.push({ text: '●', color });
    } else if (i === step) {
      dots.push({ text: '●', color, bold: true });
    } else {
      dots.push({ text: '○', dimColor: true });
    }
  }
  const needsRound = entry.autoFixRounds > 0 && !/round/i.test(entry.phaseLabel);
  const phaseText = needsRound
    ? `${entry.phaseLabel} · round ${entry.autoFixRounds}`
    : entry.phaseLabel;
  const ageLen = Array.from(entry.totalAge).length;
  const room = Math.max(0, inner - segLen(dots) - 2 - ageLen);
  const phase = truncate(phaseText, room);
  const pad = ' '.repeat(Math.max(0, room - Array.from(phase).length));
  return [...dots, { text: '  ' }, { text: phase }, { text: pad }, { text: entry.totalAge }];
}

export function StepTracker({
  entry,
  compact,
  width,
  border,
}: {
  entry: WatchEntry;
  compact: boolean;
  width: number;
  border: Border;
}): ReactNode {
  return <Line segs={bodyLine(trackerSegs(entry, compact, width - 3), width, border)} />;
}

function LiveStepLine({
  step,
  width,
  border,
  icons,
  color,
}: {
  step: string;
  width: number;
  border: Border;
  icons: boolean;
  color: string;
}): ReactNode {
  const { frame } = useAnimation({ interval: 80 });
  const glyph = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0] ?? '';
  const icon = liveStepIcon(step);
  const prefix = `${glyph} ${icon === null ? '' : iconText(icon, icons)}`;
  const inner = width - 3;
  const line = `${prefix}${truncate(step, inner - Array.from(prefix).length)}`;
  return <Line segs={bodyLine([{ text: line, color }], width, border)} />;
}

export function speedSegs(
  speed: SessionSpeed | null,
  compact: boolean,
  inner: number,
  icons: boolean,
  color: string,
): Seg[] {
  if (speed === null) {
    return [{ text: truncate('measuring…', inner), dimColor: true }];
  }
  const segs: Seg[] = [
    { text: iconText('working', icons), color: 'cyan' },
    { text: speed.tokPerSec.toFixed(1), color },
    { text: ' tok/s · ', dimColor: true },
    { text: iconText('clock', icons), dimColor: true },
    { text: `${formatDuration(speed.secPerStep)}/step · `, dimColor: true },
    { text: iconText('context', icons), dimColor: true },
    { text: formatContext(speed.context), color: contextColorName(speed.context) },
  ];
  if (!compact) {
    segs.push({ text: `  ${sparkline(speed.spark)}`, color: 'cyan' });
  }
  return truncateSegs(segs, inner);
}

function filesSegs(
  files: ChangedFile[],
  compact: boolean,
  inner: number,
  icons: boolean,
): Seg[] | null {
  if (files.length === 0) {
    return null;
  }
  let created = 0;
  let modified = 0;
  let deleted = 0;
  const createdNames: string[] = [];
  const modifiedNames: string[] = [];
  for (const file of files) {
    if (file.kind === 'created') {
      created += 1;
      createdNames.push(path.basename(file.path));
    } else if (file.kind === 'modified') {
      modified += 1;
      modifiedNames.push(path.basename(file.path));
    } else {
      deleted += 1;
    }
  }
  const segs: Seg[] = [
    { text: `${iconText('added', icons)}${created}`, color: 'green' },
    { text: '  ' },
    { text: `${iconText('modified', icons)}${modified}`, color: 'yellow' },
    { text: '  ' },
    { text: `${iconText('removed', icons)}${deleted}`, color: 'red' },
  ];
  if (!compact) {
    for (const name of [...createdNames, ...modifiedNames]) {
      if (segLen(segs) + 2 + Array.from(name).length > inner) {
        break;
      }
      segs.push({ text: `  ${name}`, dimColor: true });
    }
  }
  return truncateSegs(segs, inner);
}

export function FilesLine({
  files,
  compact,
  width,
  border,
  icons,
}: {
  files: ChangedFile[];
  compact: boolean;
  width: number;
  border: Border;
  icons: boolean;
}): ReactNode {
  const content = filesSegs(files, compact, width - 3, icons);
  if (content === null) {
    return null;
  }
  return <Line segs={bodyLine(content, width, border)} />;
}

export function Header({
  view,
  clock,
  width,
  icons,
}: {
  view: WatchView;
  clock: string;
  width: number;
  icons: boolean;
}): ReactNode {
  const border: Border = { dimColor: true };
  const working = view.entries.filter((entry) => entry.running).length;
  const needsYou = view.entries.filter((entry) => entry.needsLead).length;
  const needsCounter: Seg = {
    text: `${iconText('needsYou', icons)}${needsYou} needs you`,
    color: 'yellow',
  };
  if (needsYou > 0) {
    needsCounter.bold = true;
  }
  const counts: Seg[] = [
    { text: `${iconText('working', icons)}${working} working`, color: 'cyan' },
    { text: '   ' },
    needsCounter,
    { text: '   ' },
    { text: `${iconText('merged', icons)}${view.mergedToday} merged today`, color: 'green' },
  ];
  return (
    <>
      <Line
        segs={topBorder(
          [
            { text: iconText('brand', icons), color: 'magenta' },
            { text: 'zilar · lead', bold: true },
          ],
          [
            { text: iconText('clock', icons), dimColor: true },
            { text: clock, dimColor: true },
          ],
          width,
          border,
        )}
      />
      <Line segs={bodyLine(counts, width, border)} />
      <Line segs={bottom(width, border)} />
    </>
  );
}

export function TaskCard({
  entry,
  width,
  compact,
  icons,
}: {
  entry: WatchEntry;
  width: number;
  compact: boolean;
  icons: boolean;
}): ReactNode {
  const phaseColor = phaseColorName(entry.phaseId);
  const border: Border = { color: phaseColor };
  const inner = width - 3;
  const { frame } = useAnimation({ interval: 80 });
  const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0] ?? '';
  const marker = entry.running
    ? `${spinner} `
    : entry.needsLead
      ? iconText('needsYou', icons)
      : iconText('idle', icons);
  const waiting = entry.needsLead;
  const waitingLine: Seg[] = waiting
    ? [{ text: `${iconText('needsYou', icons)}review the packet and merge`, color: 'yellow' }]
    : [];
  const idleLine: Seg[] = waiting
    ? [{ text: `${iconText('idle', icons)}idle · waiting for you`, dimColor: true }]
    : speedSegs(entry.speed, compact, inner, icons, phaseColor);
  const left: Seg[] =
    marker === ''
      ? [{ text: entry.id, bold: true, color: phaseColor }]
      : [
          { text: marker, color: phaseColor },
          { text: entry.id, bold: true, color: phaseColor },
        ];
  return (
    <>
      <Line
        segs={topBorder(left, badgeSegs(modelBadge(entry.model, entry.effort)), width, border)}
      />
      <Line segs={bodyLine([{ text: truncate(entry.title, inner) }], width, border)} />
      <StepTracker entry={entry} compact={compact} width={width} border={border} />
      {entry.running && entry.step !== null ? (
        <LiveStepLine
          step={entry.step}
          width={width}
          border={border}
          icons={icons}
          color={phaseColor}
        />
      ) : waiting ? (
        <Line segs={bodyLine(waitingLine, width, border)} />
      ) : null}
      <Line segs={bodyLine(idleLine, width, border)} />
      <FilesLine
        files={entry.files}
        compact={compact}
        width={width}
        border={border}
        icons={icons}
      />
      <Line segs={bottom(width, border)} />
    </>
  );
}

function EmptyCard({ width }: { width: number }): ReactNode {
  const border: Border = { dimColor: true };
  return (
    <>
      <Line segs={plainTop(width, border)} />
      <Line segs={bodyLine([{ text: 'No tasks in flight.', dimColor: true }], width, border)} />
      <Line segs={bottom(width, border)} />
    </>
  );
}

export function Footer({
  view,
  updatedAgoSecs,
  icons,
  width,
}: {
  view: WatchView;
  updatedAgoSecs: number;
  icons: boolean;
  width: number;
}): ReactNode {
  if (view.refreshFailed) {
    return <Text color="red">refresh failed, retrying</Text>;
  }
  const secs = Math.max(0, Math.round(updatedAgoSecs));
  const cut = truncate(`q quit · ${iconText('branch', icons)}main · updated ${secs} s ago`, width);
  return (
    <Text dimColor>
      <Text inverse>{cut.slice(0, 1)}</Text>
      <Text>{cut.slice(1)}</Text>
    </Text>
  );
}

export interface WatchAppProps {
  view: WatchView;
  updatedAgoSecs: number;
  columns?: number;
  clock?: string;
  icons?: boolean;
}

export function WatchApp({
  view,
  updatedAgoSecs,
  columns,
  clock,
  icons,
}: WatchAppProps): ReactNode {
  const { stdout } = useStdout();
  const ttyColumns = (stdout as { columns?: unknown }).columns;
  const width = Math.max(
    20,
    Math.floor(columns ?? (typeof ttyColumns === 'number' ? ttyColumns : 80)),
  );
  const showIcons = icons ?? iconsEnabled(false);
  const compact = width < COMPACT_WIDTH;
  return (
    <Box flexDirection="column" width={width}>
      <Header view={view} clock={clock ?? view.clock} width={width} icons={showIcons} />
      {view.entries.map((entry) => (
        <TaskCard key={entry.id} entry={entry} width={width} compact={compact} icons={showIcons} />
      ))}
      {view.entries.length === 0 ? <EmptyCard width={width} /> : null}
      <Footer view={view} updatedAgoSecs={updatedAgoSecs} icons={showIcons} width={width} />
    </Box>
  );
}

// The live shell around `WatchApp`: refreshes the view every 3 seconds from
// a `lead watch --data` child process (its synchronous git/OpenCode calls
// never block the animation), ticks the clock every second, and quits
// cleanly on `q` or Ctrl-C through Ink, which restores the terminal.
export function WatchLive({ initial, icons }: { initial: WatchView; icons?: boolean }): ReactNode {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [view, setView] = useState<WatchView>(initial);
  const [updatedAt, setUpdatedAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());

  useInput(
    (input, key) => {
      if (input === 'q' || input === 'Q' || (key.ctrl && (input === 'c' || input === 'C'))) {
        exit();
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
    />
  );
}
