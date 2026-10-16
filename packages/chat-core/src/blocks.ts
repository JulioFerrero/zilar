import type { CalloutBlock, Change, ChecklistBlock, StatusBlock } from '@zilar/protocol';

// The tone vocabulary shared by every block renderer, so web and phone paint the
// same meaning with the same colour.
export type BlockTone = 'positive' | 'negative' | 'neutral' | 'warning' | 'info';

// Decides a number change's tone; web and phone both colour the value with it.
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

// Decides a status row's tone; web and phone both colour its dot with it.
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

// Decides a callout's tone; web and phone both colour the callout with it.
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

// Builds the SVG `d` of a sparkline scaled into a `width`×`height` box with `pad`
// on every side; web and phone both draw the polyline from it. Flat series sit on
// the mid-line, and fewer than two points have nothing to draw.
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

// Counts a checklist's done and total items; web and phone both show the fraction.
export function checklistCount(block: ChecklistBlock): { done: number; total: number } {
  return {
    done: block.items.filter((item) => item.done).length,
    total: block.items.length,
  };
}

// Reads a link's display host without a leading `www.`; web and phone both label
// the link with it, and a URL with no https host has none. Parsed with a regex so
// the ES2023-only lib never needs the DOM `URL` type.
export function linkHost(url: string): string {
  const host = /^https:\/\/(?:[^@/?#]*@)?([^:/?#]+)/.exec(url)?.[1];
  return host === undefined ? '' : host.replace(/^www\./, '');
}
