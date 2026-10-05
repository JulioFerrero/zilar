import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { depth, palette, platformDifferences, radius, type PaletteKey } from '@zilar/ui-tokens';

// Fails when `index.css` drifts from `@zilar/ui-tokens`. Every palette value
// must equal its `:root` variable, and every depth string must appear in its
// utility (compared after normalising: remove all whitespace, write numbers
// without trailing zeros). The recorded platform differences are skipped by
// name and read from `platformDifferences`.

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'index.css'), 'utf8');

// The `:root` block holds the D24 values; other blocks (`.bubble-out`, …)
// override per-context tokens like `--voice-played`, so lookups stay inside
// the first `:root { … }` block.
const rootBlock = (() => {
  const start = css.indexOf(':root {');
  if (start < 0) {
    throw new Error('missing :root block');
  }
  const end = css.indexOf('}', start);
  if (end < 0) {
    throw new Error('unterminated :root block');
  }
  return css.slice(start, end);
})();

const rootValues = new Map<string, string>();
for (const match of rootBlock.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
  rootValues.set(match[1] ?? '', (match[2] ?? '').trim().toLowerCase());
}

/** A `:root` variable with `var(--…)` aliases resolved to the literal value. */
function rootVariable(name: string): string {
  const resolve = (current: string, seen: string[]): string => {
    if (seen.includes(current)) {
      throw new Error(`cyclic alias --${current}`);
    }
    const raw = rootValues.get(current);
    if (raw === undefined) {
      throw new Error(`missing :root variable --${current}`);
    }
    const alias = /^var\(--([\w-]+)\)$/.exec(raw)?.[1];
    return alias === undefined ? raw : resolve(alias, [...seen, current]);
  };
  return resolve(name, []);
}

/** The raw declared value, aliases unresolved. */
function rawRootVariable(name: string): string {
  const raw = rootValues.get(name);
  if (raw === undefined) {
    throw new Error(`missing :root variable --${name}`);
  }
  return raw;
}

/** A variable declared outside `:root` (the radius scale in `@theme inline`). */
function cssVariable(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (match?.[1] === undefined) {
    throw new Error(`missing variable --${name}`);
  }
  return match[1].trim().toLowerCase();
}

/** Split a `box-shadow` list on top-level commas (commas inside parens stay). */
function shadowLayers(value: string): string[] {
  const layers: string[] = [];
  let depthCount = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') {
      depthCount += 1;
    } else if (char === ')') {
      depthCount -= 1;
    }
    if (char === ',' && depthCount === 0) {
      layers.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  layers.push(current);
  return layers.map((layer) => layer.trim()).filter((layer) => layer.length > 0);
}

/** Remove all whitespace and drop trailing zeros after a decimal point. */
export function normalize(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/(\.\d*?)0+(?=[,)])/g, '$1')
    .replace(/\.(?=[,)])/g, '');
}

const SKIPPED = new Set(platformDifferences.map((difference) => difference.name));

const VAR_NAME: Record<PaletteKey, string> = {
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
  iconColor: 'key-icon-color',
};

const UTILITY: Record<string, string> = {
  keyPrimaryGradient: 'key-primary',
  keyPrimaryShadow: 'key-primary',
  keyPrimaryPressedShadow: 'key-primary',
  keyIconGradient: 'key-icon',
  keyIconShadow: 'key-icon',
  keyIconPressedShadow: 'key-icon',
  wellShadow: 'well-surface',
  segmentGradient: 'segment-raised',
  segmentShadow: 'segment-raised',
  pillGradient: 'raised-pill',
  pillShadow: 'raised-pill',
  bubbleOutGradient: 'bubble-out',
  bubbleOutShadow: 'bubble-out',
  bubbleInGradient: 'bubble-in',
  bubbleInShadow: 'bubble-in',
};

const BUBBLE_GEN_UTILITY = 'bubble-gen';

const ALIASES: Record<string, string> = {
  background: 'var(--panel)',
  card: 'var(--panel)',
  popover: 'var(--surface)',
  primary: 'var(--accent)',
  'primary-foreground': 'var(--accent-foreground)',
  secondary: 'var(--surface)',
  'secondary-foreground': 'var(--foreground)',
  muted: 'var(--surface)',
  destructive: 'var(--danger)',
  ring: 'var(--muted-foreground)',
  'card-foreground': 'var(--foreground)',
  'popover-foreground': 'var(--foreground)',
  input: 'var(--border-strong)',
  divider: 'var(--border)',
  'list-hover': 'var(--surface-raised)',
  'list-active': 'var(--surface-raised)',
};

function utilityBlock(name: string): string {
  const start = css.indexOf(`@utility ${name} `);
  if (start < 0) {
    throw new Error(`missing @utility ${name}`);
  }
  const next = css.indexOf('@utility ', start + 1);
  return css.slice(start, next < 0 ? undefined : next);
}

describe('ui tokens drift (index.css)', () => {
  it('matches every shared palette value', () => {
    const checked: string[] = [];
    for (const [key, variable] of Object.entries(VAR_NAME)) {
      if (SKIPPED.has(variable)) {
        continue;
      }
      if (variable === 'key-icon-color') {
        expect(normalize(css).toLowerCase()).toContain(
          normalize(`color:${palette[key as PaletteKey]}`),
        );
        checked.push(variable);
        continue;
      }
      const expected = palette[key as PaletteKey].toLowerCase();
      expect(rootVariable(variable), `--${variable}`).toBe(expected);
      checked.push(variable);
    }
    expect(checked.length).toBeGreaterThan(10);
  });

  it('keeps the shadcn aliases on the D24 values', () => {
    for (const [variable, expected] of Object.entries(ALIASES)) {
      expect(rawRootVariable(variable), `--${variable}`).toBe(expected);
    }
  });

  it('keeps the radius scale', () => {
    expect(cssVariable('radius')).toBe(radius.base);
    expect(cssVariable('radius-sm')).toBe(radius.sm);
    expect(cssVariable('radius-md')).toBe(radius.md);
    expect(cssVariable('radius-lg')).toBe(radius.lg);
    expect(cssVariable('radius-xl')).toBe(radius.xl);
  });

  it('renders every depth string in its utility', () => {
    for (const [key, utility] of Object.entries(UTILITY)) {
      const expected = normalize(depth[key as keyof typeof depth]).toLowerCase();
      expect(normalize(utilityBlock(utility)).toLowerCase(), `${key} in ${utility}`).toContain(
        expected,
      );
    }
  });

  it('renders the shared bubble-gen recess inside the generating look', () => {
    // Web `bubble-gen` layers one extra drop shadow under the shared recess
    // (a web-only tail on the generating bubble); two of the three shared
    // layers must still render verbatim.
    const rendered = normalize(utilityBlock(BUBBLE_GEN_UTILITY)).toLowerCase();
    const shared = shadowLayers(normalize(depth.bubbleGenShadow).toLowerCase());
    const hits = shared.filter((layer) => rendered.includes(layer));
    expect(shared.length).toBe(3);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(rendered).toContain('inset02px6pxrgba(0,0,0,0.9)');
  });

  it('keeps the recorded differences', () => {
    expect(rootVariable('chat-background')).toContain('radial-gradient');
    for (const name of [
      'key-text-shadow',
      'avatar-ring',
      'list-active-foreground',
      'voice-played',
      'voice-unplayed',
    ]) {
      expect(SKIPPED.has(name), name).toBe(true);
      expect(rootVariable(name).length).toBeGreaterThan(0);
    }
  });

  it('normalises numbers without trailing zeros', () => {
    expect(normalize('rgba(255,255,255,0.40)')).toBe('rgba(255,255,255,0.4)');
    expect(normalize('0 1px 0 rgba(0, 0, 0, 0.95)')).toBe('01px0rgba(0,0,0,0.95)');
  });
});
