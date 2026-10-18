import type { CalloutBlock, Change, ChecklistBlock, StatusBlock } from '@zilar/protocol';

export type BlockTone = 'positive' | 'negative' | 'neutral' | 'warning' | 'info';

export function changeTone(change: Change): BlockTone {
  switch (change.direction) {
    case 'up':
      return 'positive';
    case 'down':
      return 'negative';
    case 'flat':
      return 'neutral';
  }
}

export function statusTone(status: StatusBlock['rows'][number]['status']): BlockTone {
  switch (status) {
    case 'ok':
      return 'positive';
    case 'warn':
      return 'warning';
    case 'bad':
      return 'negative';
  }
}

export function calloutTone(tone: CalloutBlock['tone']): BlockTone {
  switch (tone) {
    case 'success':
      return 'positive';
    case 'warning':
      return 'warning';
    case 'error':
      return 'negative';
    case 'info':
      return 'info';
  }
}

// Builds the SVG `d` of a sparkline; flat series sit on the mid-line, and fewer than two points have nothing to draw.
export function sparklinePath(
  points: readonly number[],
  width: number,
  height: number,
  pad = 2,
): string {
  if (points.length < 2) return '';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const round = (value: number): number => Math.round(value * 10) / 10;
  return points
    .map((point, index) => {
      const x = pad + ((width - pad * 2) * index) / (points.length - 1);
      const y = span === 0 ? height / 2 : pad + (1 - (point - min) / span) * (height - pad * 2);
      return `${index === 0 ? 'M' : 'L'} ${round(x)} ${round(y)}`;
    })
    .join(' ');
}

export function checklistCount(block: ChecklistBlock): { done: number; total: number } {
  return {
    done: block.items.filter((item) => item.done).length,
    total: block.items.length,
  };
}

// Parsed with a regex so the ES2023-only lib never needs the DOM `URL` type.
export function linkHost(url: string): string {
  const host = /^https:\/\/(?:[^@/?#]*@)?([^:/?#]+)/.exec(url)?.[1];
  return host === undefined ? '' : host.replace(/^www\./, '');
}
