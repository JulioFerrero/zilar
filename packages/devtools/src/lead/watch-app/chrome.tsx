// The `lead watch` chrome: the three-line header, a task card, the empty
// placeholder and the footer. Moved unchanged from `lead/watch-app.tsx`
// (size split), except the spinner-frame expression, now `useSpinner`.

import { Text } from 'ink';
import type { ReactNode } from 'react';
import { iconText, modelBadge, phaseColorName, truncate } from '../watch-format.js';
import type { WatchEntry, WatchView } from '../watch.js';
import { badgeSegs, FilesLine, LiveStepLine, speedSegs, StepTracker } from './lines.js';
import {
  bodyLine,
  bottom,
  Line,
  plainTop,
  topBorder,
  useSpinner,
  type Border,
  type Seg,
} from './segments.js';

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
  const spinner = useSpinner();
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

export function EmptyCard({ width }: { width: number }): ReactNode {
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
  hiddenAbove = 0,
  hiddenBelow = 0,
}: {
  view: WatchView;
  updatedAgoSecs: number;
  icons: boolean;
  width: number;
  hiddenAbove?: number;
  hiddenBelow?: number;
}): ReactNode {
  if (view.refreshFailed) {
    return <Text color="red">refresh failed, retrying</Text>;
  }
  const secs = Math.max(0, Math.round(updatedAgoSecs));
  const hints: string[] = [];
  if (hiddenAbove > 0) {
    hints.push(`↑ ${hiddenAbove} more`);
  }
  if (hiddenBelow > 0) {
    hints.push(`↓ ${hiddenBelow} more`);
  }
  const help =
    hints.length > 0
      ? `q quit · ↑↓ scroll · ${iconText('branch', icons)}main · updated ${secs} s ago`
      : `q quit · ${iconText('branch', icons)}main · updated ${secs} s ago`;
  const text = hints.length > 0 ? `${hints.join(' · ')} · ${help}` : help;
  const cut = truncate(text, width);
  return (
    <Text dimColor>
      <Text inverse>{cut.slice(0, 1)}</Text>
      <Text>{cut.slice(1)}</Text>
    </Text>
  );
}
