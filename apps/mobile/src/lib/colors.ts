import { palette } from '@zilar/ui-tokens';

/**
 * Literal colors that cannot go through NativeWind class names: SVG fills and
 * native props like `ActivityIndicator color`. Keep in sync with `global.css`.
 * The app is dark only (D24).
 */
export const CHAT_BACKGROUND: readonly [string, string] = ['#000000', '#000000'];

export const BUBBLE_COLORS: {
  incoming: string;
  outgoing: string;
  incomingMeta: string;
  outgoingMeta: string;
} = {
  incoming: palette.bubbleIn,
  outgoing: palette.bubbleOut,
  incomingMeta: palette.bubbleInMeta,
  outgoingMeta: palette.bubbleOutMeta,
};

export const ACCENT: string = palette.accent;

export const ACCENT_FOREGROUND: string = palette.accentForeground;

export const MUTED_FOREGROUND: string = palette.mutedForeground;

export const FOREGROUND: string = palette.foreground;

/** The icon-key glyph color from ui-style.md §4. */
export const ICON: string = palette.iconColor;

/** Monochrome accents used by the depth recipes and bubbles. */
export const EDGE = palette.edge;
export const DANGER = palette.danger;
