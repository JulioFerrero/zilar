import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { palette, platformDifferences, type PaletteKey } from '@zilar/ui-tokens';

// Fails when `global.css` drifts from `@zilar/ui-tokens`. Every palette value
// must equal its `:root` variable; the recorded platform differences are
// skipped by name and read from `platformDifferences`.

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'global.css'), 'utf8');

function rootVariable(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (match?.[1] === undefined) {
    throw new Error(`missing :root variable --${name}`);
  }
  return match[1].trim().toLowerCase();
}

const SKIPPED = new Set(
  platformDifferences.map((difference) => difference.name.replace(/-literal$/, '')),
);

const VAR_NAME: Record<Exclude<PaletteKey, 'iconColor'>, string> = {
  page: 'page',
  panel: 'panel',
  surface: 'surface',
  surfaceRaised: 'surface-raised',
  well: 'well',
  border: 'border',
  borderStrong: 'border-strong',
  edge: 'edge',
  foreground: 'foreground',
  mutedForeground: 'muted-foreground',
  subtleForeground: 'subtle-foreground',
  generatingForeground: 'generating-foreground',
  accent: 'accent',
  accentForeground: 'accent-foreground',
  online: 'online',
  danger: 'danger',
  badgeMuted: 'badge-muted',
  bubbleIn: 'bubble-in',
  bubbleOut: 'bubble-out',
  bubbleInMeta: 'bubble-in-meta',
  bubbleOutMeta: 'bubble-out-meta',
  destructiveForeground: 'destructive-foreground',
};

describe('ui tokens drift (global.css)', () => {
  it('matches every shared palette value', () => {
    const checked: string[] = [];
    for (const [key, variable] of Object.entries(VAR_NAME)) {
      if (SKIPPED.has(variable)) {
        continue;
      }
      const expected = palette[key as PaletteKey].toLowerCase();
      expect(rootVariable(variable), `--${variable}`).toBe(expected);
      checked.push(variable);
    }
    expect(checked.length).toBe(22);
  });

  it('keeps the recorded differences', () => {
    // The `--chat-background` variable is unused by the chat: the SVG grid in
    // `components/chat/chat-background.tsx` draws the dots from `chatGrid`.
    expect(rootVariable('chat-background')).toBe('#0a0a0a');
  });
});
