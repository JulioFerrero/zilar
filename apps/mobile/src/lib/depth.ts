import type { TextStyle, ViewStyle } from 'react-native';

/**
 * The four skeuomorphic depth recipes from docs/design/ui-style.md §4, plus the
 * bubble looks from §5. Every shadow and gradient string lives here once; the
 * `ui/*` components and the chat pieces apply them, never ad hoc.
 */

export const ACCENT = '#ededed';
export const ACCENT_FOREGROUND = '#0a0a0a';
export const EDGE = '#050505';
export const BORDER = '#1f1f1f';
export const BORDER_STRONG = '#262626';
export const WELL_BACKGROUND = '#0c0c0c';
export const ICON_COLOR = '#d4d4d4';

/** Primary (accent) button, badge and FAB: a glossy key (§4). */
export const KEY_PRIMARY_GRADIENT =
  'linear-gradient(180deg, rgba(255,255,255,0.40), rgba(255,255,255,0.08) 48%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.14))';
export const KEY_PRIMARY_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -2px 0 rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.12), 0 1px 0 rgba(0,0,0,0.95), 0 2px 3px rgba(0,0,0,0.7), 0 10px 18px -8px rgba(0,0,0,0.95)';
export const KEY_PRIMARY_PRESSED_SHADOW =
  'inset 0 2px 5px rgba(0,0,0,0.35), 0 1px 0 rgba(0,0,0,0.95)';

/** Icon button: a dark key (§4). */
export const KEY_ICON_GRADIENT = 'linear-gradient(180deg, #2c2c2c, #151515)';
export const KEY_ICON_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.65), 0 1px 0 rgba(0,0,0,0.95), 0 3px 6px -1px rgba(0,0,0,0.75)';
export const KEY_ICON_PRESSED_SHADOW = 'inset 0 2px 5px rgba(0,0,0,0.9)';

/** Well: recessed search, composer and segment track (§4). */
export const WELL_SHADOW =
  'inset 0 2px 6px rgba(0,0,0,0.9), inset 0 1px 1px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.06)';

/** Raised segment: the active folder tab (§4). */
export const SEGMENT_GRADIENT = 'linear-gradient(180deg, #333333, #1c1c1c)';
export const SEGMENT_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.6), 0 1px 0 rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7)';

/** Raised pill: the date separator and big-emoji meta (§4). */
export const PILL_GRADIENT = 'linear-gradient(180deg, #1f1f1f, #121212)';
export const PILL_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 0 rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.6)';

/** Bubble looks (§5). */
export const BUBBLE_OUT_GRADIENT = 'linear-gradient(180deg, #ffffff, #dedede)';
export const BUBBLE_OUT_SHADOW =
  'inset 0 1px 0 #ffffff, inset 0 -3px 6px rgba(0,0,0,0.08), 0 1px 0 rgba(0,0,0,0.95), 0 4px 10px -3px rgba(0,0,0,0.85)';
export const BUBBLE_IN_GRADIENT = 'linear-gradient(180deg, #252525, #161616)';
export const BUBBLE_IN_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.6), 0 1px 0 rgba(0,0,0,0.95), 0 4px 10px -3px rgba(0,0,0,0.85)';
export const BUBBLE_GEN_SHADOW =
  'inset 0 2px 6px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.06)';

export const TEXT_SHADOW_LIGHT: TextStyle = {
  textShadowColor: 'rgba(255,255,255,0.7)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 0,
};

export const TEXT_SHADOW_DARK: TextStyle = {
  textShadowColor: 'rgba(0,0,0,0.7)',
  textShadowOffset: { width: 0, height: -1 },
  textShadowRadius: 0,
};

export const primaryKey: ViewStyle = {
  backgroundColor: ACCENT,
  experimental_backgroundImage: KEY_PRIMARY_GRADIENT,
  boxShadow: KEY_PRIMARY_SHADOW,
};

export const iconKey: ViewStyle = {
  experimental_backgroundImage: KEY_ICON_GRADIENT,
  borderWidth: 1,
  borderColor: EDGE,
  boxShadow: KEY_ICON_SHADOW,
};

export const well: ViewStyle = {
  backgroundColor: WELL_BACKGROUND,
  borderWidth: 1,
  borderColor: BORDER,
  boxShadow: WELL_SHADOW,
};

export const segment: ViewStyle = {
  experimental_backgroundImage: SEGMENT_GRADIENT,
  boxShadow: SEGMENT_SHADOW,
};

export const raisedPill: ViewStyle = {
  experimental_backgroundImage: PILL_GRADIENT,
  borderWidth: 1,
  borderColor: EDGE,
  boxShadow: PILL_SHADOW,
};

/**
 * The pressed state of a key: swap to the pressed shadow and sink 1 px (§4).
 * No translation when the user asked for reduced motion.
 */
export function pressStyle(
  pressed: boolean,
  pressedShadow: string,
  reduceMotion: boolean,
): ViewStyle | undefined {
  if (!pressed) {
    return undefined;
  }
  return {
    boxShadow: pressedShadow,
    ...(reduceMotion ? {} : { transform: [{ translateY: 1 }] }),
  };
}

export type BubbleLook = 'outgoing' | 'incoming' | 'generating';

/**
 * Picks the bubble style for a look and the last-in-group tail radius, so the
 * three looks share one place (and one set of numbers).
 */
export function bubbleStyle(look: BubbleLook, lastInGroup: boolean): ViewStyle {
  const tail: ViewStyle =
    look === 'outgoing' ? { borderBottomRightRadius: 4 } : { borderBottomLeftRadius: 4 };
  const radius = lastInGroup ? tail : {};
  if (look === 'outgoing') {
    return {
      ...radius,
      experimental_backgroundImage: BUBBLE_OUT_GRADIENT,
      boxShadow: BUBBLE_OUT_SHADOW,
    };
  }
  if (look === 'generating') {
    return {
      ...radius,
      backgroundColor: WELL_BACKGROUND,
      borderWidth: 1,
      borderColor: '#1a1a1a',
      boxShadow: BUBBLE_GEN_SHADOW,
    };
  }
  return {
    ...radius,
    experimental_backgroundImage: BUBBLE_IN_GRADIENT,
    borderWidth: 1,
    borderColor: EDGE,
    boxShadow: BUBBLE_IN_SHADOW,
  };
}

/** Monochrome-friendly sender name colors (ui-style.md §5). */
export const SENDER_COLORS = ['#d4d4d4', '#a1a1a1', '#8a8a8a', '#ededed'] as const;

/** Picks a sender color deterministically from an id. */
export function senderColor(id: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return SENDER_COLORS[(hash >>> 0) % SENDER_COLORS.length] ?? SENDER_COLORS[0];
}

/** Monochrome avatar shades (ui-style.md §2). */
export const AI_SHADE = { background: '#ededed', color: '#0a0a0a', ring: false } as const;
export const PERSON_SHADES = [
  { background: '#262626', color: '#ededed', ring: false },
  { background: '#1a1a1a', color: '#ededed', ring: true },
] as const;

export interface AvatarShade {
  background: string;
  color: string;
  ring: boolean;
}

/** Picks the avatar shade deterministically from the id; AIs get the light one. */
export function avatarShade(id: string, ai = false): AvatarShade {
  if (ai) {
    return AI_SHADE;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return PERSON_SHADES[(hash >>> 0) % PERSON_SHADES.length] ?? PERSON_SHADES[0];
}
