// The `lead watch` card lines: the model badge, the four-step tracker, the
// live step line, the speed line and the changed-files line. Moved unchanged
// from `lead/watch-app.tsx` (size split).

import path from 'node:path';
import type { ReactNode } from 'react';
import {
  contextColorName,
  iconText,
  liveStepIcon,
  modelBadge,
  phaseColorName,
  trackerStep,
  truncate,
  type ModelBadge,
} from '../watch-format.js';
import { formatContext, formatDuration, sparkline } from '../watch.js';
import type { ChangedFile, SessionSpeed, WatchEntry } from '../watch.js';
import {
  bodyLine,
  Line,
  segLen,
  truncateSegs,
  useSpinner,
  type Border,
  type Seg,
} from './segments.js';

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

export function LiveStepLine({
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
  const glyph = useSpinner();
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
