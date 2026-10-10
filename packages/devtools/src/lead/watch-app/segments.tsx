// The card renderer's shared segment helpers: styled text runs, truncation,
// the bordered box primitives and the one animated spinner hook. Moved
// unchanged from `lead/watch-app.tsx` (size split), except the spinner-frame
// expression, which `LiveStepLine` and `TaskCard` shared and is now `useSpinner`.

import { Text, useAnimation } from 'ink';
import type { ReactNode } from 'react';
import { cardHeight, SPINNER_FRAMES, truncate } from '../watch-format.js';
import type { WatchEntry } from '../watch.js';

export interface Seg {
  text: string;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
}

export interface Border {
  color?: string;
  dimColor?: boolean;
}

// The header is a three-line bordered box; the footer takes one line.
export const HEADER_ROWS = 3;

// Groups entries into rows of `columnCount` cards (1 or 2).
export function rowsOf(entries: WatchEntry[], columnCount: number): WatchEntry[][] {
  const rows: WatchEntry[][] = [];
  for (let index = 0; index < entries.length; index += columnCount) {
    rows.push(entries.slice(index, index + columnCount));
  }
  return rows;
}

// A row is as tall as its tallest card, so a short card never hides the next.
export function rowHeights(rows: WatchEntry[][]): number[] {
  return rows.map((cards) => Math.max(0, ...cards.map((card) => cardHeight(card))));
}

export function segLen(segs: Seg[]): number {
  return segs.reduce((sum, seg) => sum + Array.from(seg.text).length, 0);
}

// Cut segments to `width` on their plain concatenation. Styles past the cut
// are dropped, so callers fit the parts they care about before joining.
export function truncateSegs(segs: Seg[], width: number): Seg[] {
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

export function Line({ segs }: { segs: Seg[] }): ReactNode {
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
export function topBorder(left: Seg[], right: Seg[], width: number, border: Border): Seg[] {
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

export function plainTop(width: number, border: Border): Seg[] {
  return [borderSeg(`╭${'─'.repeat(Math.max(0, width - 2))}╮`, border)];
}

export function bottom(width: number, border: Border): Seg[] {
  return [borderSeg(`╰${'─'.repeat(Math.max(0, width - 2))}╯`, border)];
}

export function bodyLine(content: Seg[], width: number, border: Border): Seg[] {
  const inner = width - 3;
  const cut = truncateSegs(content, inner);
  const pad = ' '.repeat(Math.max(0, inner - segLen(cut)));
  return [borderSeg('│ ', border), ...cut, { text: pad }, borderSeg('│', border)];
}

// The animated braille glyph on the live step line and the running-card marker.
export function useSpinner(): string {
  const { frame } = useAnimation({ interval: 80 });
  return SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0] ?? '';
}
