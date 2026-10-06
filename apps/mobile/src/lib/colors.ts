import type { ColorScheme } from './color-scheme';
import { palette } from '@zilar/ui-tokens';

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
    incoming: palette.bubbleIn,
    outgoing: palette.bubbleOut,
    incomingMeta: palette.bubbleInMeta,
    outgoingMeta: palette.bubbleOutMeta,
  },
  dark: {
    incoming: palette.bubbleIn,
    outgoing: palette.bubbleOut,
    incomingMeta: palette.bubbleInMeta,
    outgoingMeta: palette.bubbleOutMeta,
  },
};

export const ACCENT: Record<ColorScheme, string> = {
  light: palette.accent,
  dark: palette.accent,
};

export const ACCENT_FOREGROUND: Record<ColorScheme, string> = {
  light: palette.accentForeground,
  dark: palette.accentForeground,
};

export const MUTED_FOREGROUND: Record<ColorScheme, string> = {
  light: palette.mutedForeground,
  dark: palette.mutedForeground,
};

export const FOREGROUND: Record<ColorScheme, string> = {
  light: palette.foreground,
  dark: palette.foreground,
};

/** The icon-key glyph color from ui-style.md §4. */
export const ICON: Record<ColorScheme, string> = {
  light: palette.iconColor,
  dark: palette.iconColor,
};

/** Monochrome accents used by the depth recipes and bubbles. */
export const EDGE = palette.edge;
export const DANGER = palette.danger;
