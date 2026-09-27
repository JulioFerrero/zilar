import type { ColorScheme } from './color-scheme';

/**
 * Literal colors that cannot go through NativeWind class names: SVG fills and
 * native props like `ActivityIndicator color`. Keep in sync with `global.css`.
 */
export const CHAT_BACKGROUND: Record<ColorScheme, readonly [string, string]> = {
  light: ['#c9dfc5', '#d8e8f0'],
  dark: ['#0e1621', '#0e1621'],
};

export const BUBBLE_COLORS: Record<
  ColorScheme,
  { incoming: string; outgoing: string; incomingMeta: string; outgoingMeta: string }
> = {
  light: {
    incoming: '#ffffff',
    outgoing: '#eeffde',
    incomingMeta: '#a0acb6',
    outgoingMeta: '#4fae4e',
  },
  dark: {
    incoming: '#182533',
    outgoing: '#2b5278',
    incomingMeta: '#6d7f8f',
    outgoingMeta: '#7da8d3',
  },
};

export const ACCENT: Record<ColorScheme, string> = {
  light: '#3390ec',
  dark: '#5288c1',
};

export const MUTED_FOREGROUND: Record<ColorScheme, string> = {
  light: '#707579',
  dark: '#708499',
};

export const FOREGROUND: Record<ColorScheme, string> = {
  light: '#000000',
  dark: '#f5f5f5',
};
