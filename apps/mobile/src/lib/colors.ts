import type { ColorScheme } from './color-scheme';

/**
 * Literal colors that cannot go through NativeWind class names: SVG fills and
 * native props like `ActivityIndicator color`. Keep in sync with `global.css`.
 * The app is dark only (D24), so both schemes resolve to the same values.
 */
export const CHAT_BACKGROUND: Record<ColorScheme, readonly [string, string]> = {
  light: ['#000000', '#000000'],
  dark: ['#000000', '#000000'],
};

export const BUBBLE_COLORS: Record<
  ColorScheme,
  { incoming: string; outgoing: string; incomingMeta: string; outgoingMeta: string }
> = {
  light: {
    incoming: '#161616',
    outgoing: '#dedede',
    incomingMeta: '#8a8a8a',
    outgoingMeta: '#525252',
  },
  dark: {
    incoming: '#161616',
    outgoing: '#dedede',
    incomingMeta: '#8a8a8a',
    outgoingMeta: '#525252',
  },
};

export const ACCENT: Record<ColorScheme, string> = {
  light: '#ededed',
  dark: '#ededed',
};

export const MUTED_FOREGROUND: Record<ColorScheme, string> = {
  light: '#a1a1a1',
  dark: '#a1a1a1',
};

export const FOREGROUND: Record<ColorScheme, string> = {
  light: '#ededed',
  dark: '#ededed',
};

/** The icon-key glyph color from ui-style.md §4. */
export const ICON: Record<ColorScheme, string> = {
  light: '#d4d4d4',
  dark: '#d4d4d4',
};

/** Monochrome accents used by the depth recipes and bubbles. */
export const EDGE = '#050505';
export const DANGER = '#ef4444';
