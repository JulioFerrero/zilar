/**
 * The D24 palette, radius scale and depth recipes from
 * `docs/design/ui-style.md` §§2/4/5, as plain data (no DOM, no React Native
 * imports). Both apps read the same values: web through `index.css` `:root`
 * variables and the depth utilities, mobile through `global.css` `:root`
 * variables plus `lib/depth.ts` and `lib/colors.ts`. Nothing renders here, so
 * changing a value only lands when the consuming files take it.
 */

export const palette = {
  page: '#000000',
  panel: '#0a0a0a',
  surface: '#111111',
  surfaceRaised: '#171717',
  well: '#0c0c0c',
  border: '#1f1f1f',
  borderStrong: '#262626',
  edge: '#050505',
  foreground: '#ededed',
  mutedForeground: '#a1a1a1',
  subtleForeground: '#8a8a8a',
  generatingForeground: '#8f8f8f',
  accent: '#ededed',
  accentForeground: '#0a0a0a',
  online: '#22c55e',
  danger: '#ef4444',
  badgeMuted: '#333333',
  bubbleIn: '#161616',
  bubbleOut: '#dedede',
  bubbleInMeta: '#8a8a8a',
  bubbleOutMeta: '#525252',
  destructiveForeground: '#ffffff',
  iconColor: '#d4d4d4',
} as const;

export type PaletteKey = keyof typeof palette;

export const radius = {
  base: '0.75rem',
  sm: 'calc(var(--radius) - 4px)',
  md: 'calc(var(--radius) - 2px)',
  lg: 'var(--radius)',
  xl: 'calc(var(--radius) + 4px)',
} as const;

export type RadiusKey = keyof typeof radius;

/**
 * The gradient and shadow strings exactly as in
 * `apps/mobile/src/lib/depth.ts` (which is also what the web utilities in
 * `apps/web/src/index.css` render, modulo CSS whitespace).
 */
export const depth = {
  keyPrimaryGradient:
    'linear-gradient(180deg, rgba(255,255,255,0.40), rgba(255,255,255,0.08) 48%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.14))',
  keyPrimaryShadow:
    'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -2px 0 rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.12), 0 1px 0 rgba(0,0,0,0.95), 0 2px 3px rgba(0,0,0,0.7), 0 10px 18px -8px rgba(0,0,0,0.95)',
  keyPrimaryPressedShadow: 'inset 0 2px 5px rgba(0,0,0,0.35), 0 1px 0 rgba(0,0,0,0.95)',
  keyIconGradient: 'linear-gradient(180deg, #2c2c2c, #151515)',
  keyIconShadow:
    'inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.65), 0 1px 0 rgba(0,0,0,0.95), 0 3px 6px -1px rgba(0,0,0,0.75)',
  keyIconPressedShadow: 'inset 0 2px 5px rgba(0,0,0,0.9)',
  wellShadow:
    'inset 0 2px 6px rgba(0,0,0,0.9), inset 0 1px 1px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.06)',
  segmentGradient: 'linear-gradient(180deg, #333333, #1c1c1c)',
  segmentShadow:
    'inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.6), 0 1px 0 rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7)',
  pillGradient: 'linear-gradient(180deg, #1f1f1f, #121212)',
  pillShadow:
    'inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 0 rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.6)',
  bubbleOutGradient: 'linear-gradient(180deg, #ffffff, #dedede)',
  bubbleOutShadow:
    'inset 0 1px 0 #ffffff, inset 0 -3px 6px rgba(0,0,0,0.08), 0 1px 0 rgba(0,0,0,0.95), 0 4px 10px -3px rgba(0,0,0,0.85)',
  bubbleInGradient: 'linear-gradient(180deg, #252525, #161616)',
  bubbleInShadow:
    'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.6), 0 1px 0 rgba(0,0,0,0.95), 0 4px 10px -3px rgba(0,0,0,0.85)',
  bubbleGenShadow:
    'inset 0 2px 6px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.06)',
} as const;

export type DepthKey = keyof typeof depth;

export interface PlatformDifference {
  /** The token name, matching the CSS variable or palette key where one exists. */
  name: string;
  /** The web value (literal, alias, scale or "missing" when web has nothing). */
  web: string;
  /** The mobile value (literal, alias or "missing" when mobile has nothing). */
  mobile: string;
  note: string;
}

/**
 * Tokens that differ between web and mobile today. Kept as-is on purpose
 * (Julio decides the dot-grid question later); the drift tests skip these by
 * name and read them from here.
 */
export const platformDifferences: readonly PlatformDifference[] = [
  {
    name: 'chat-background',
    web: 'radial-gradient(#1c1c1c 1px, transparent 1px) 0 0 / 22px 22px var(--panel)',
    mobile: '#0a0a0a',
    note: 'Web renders a dot grid; mobile is a flat panel color.',
  },
  {
    name: 'chat-background-literal',
    web: 'var(--panel)',
    mobile: '#000000',
    note: 'Mobile CHAT_BACKGROUND in colors.ts is page black, not panel.',
  },
  {
    name: 'key-text-shadow',
    web: '0 1px 0 rgba(255,255,255,.7)',
    mobile: 'missing',
    note: 'Mobile primaryKey has no text shadow; web flips it dark on a future blue accent.',
  },
  {
    name: 'avatar-ring',
    web: 'var(--panel)',
    mobile: 'missing',
    note: 'Web online-dot ring follows the row; mobile has no row-aware ring token.',
  },
  {
    name: 'list-active-foreground',
    web: 'var(--foreground)',
    mobile: 'missing',
    note: 'Mobile has no list-active-foreground token.',
  },
  {
    name: 'voice-played',
    web: '#0a0a0a',
    mobile: 'missing',
    note: 'Mobile has no voice waveform tokens; colors resolve per bubble inline.',
  },
  {
    name: 'voice-unplayed',
    web: '#8a8a8a',
    mobile: 'missing',
    note: 'Mobile has no voice waveform tokens; colors resolve per bubble inline.',
  },
  {
    name: 'radius-sm',
    web: 'calc(var(--radius) - 4px)',
    mobile: 'missing',
    note: 'Mobile has only --radius, no sm/md/lg/xl scale.',
  },
  {
    name: 'radius-md',
    web: 'calc(var(--radius) - 2px)',
    mobile: 'missing',
    note: 'Mobile has only --radius, no sm/md/lg/xl scale.',
  },
  {
    name: 'radius-lg',
    web: 'var(--radius)',
    mobile: 'missing',
    note: 'Mobile has only --radius, no sm/md/lg/xl scale.',
  },
  {
    name: 'radius-xl',
    web: 'calc(var(--radius) + 4px)',
    mobile: 'missing',
    note: 'Mobile has only --radius, no sm/md/lg/xl scale.',
  },
] as const;
