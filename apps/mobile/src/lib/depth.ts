import type { ViewStyle } from 'react-native';

import { depth, palette } from '@zilar/ui-tokens';

/**
 * The four skeuomorphic depth recipes from docs/design/ui-style.md §4, plus the
 * bubble looks from §5. Every shadow and gradient string lives here once; the
 * `ui/*` components and the chat pieces apply them, never ad hoc.
 */

export const ACCENT = palette.accent;
export const ACCENT_FOREGROUND = palette.accentForeground;
export const EDGE = palette.edge;
export const BORDER = palette.border;
export const BORDER_STRONG = palette.borderStrong;
export const WELL_BACKGROUND = palette.well;
export const ICON_COLOR = palette.iconColor;

/** Primary (accent) button, badge and FAB: a glossy key (§4). */
export const KEY_PRIMARY_GRADIENT = depth.keyPrimaryGradient;
export const KEY_PRIMARY_SHADOW = depth.keyPrimaryShadow;
export const KEY_PRIMARY_PRESSED_SHADOW = depth.keyPrimaryPressedShadow;

/** Icon button: a dark key (§4). */
export const KEY_ICON_GRADIENT = depth.keyIconGradient;
export const KEY_ICON_SHADOW = depth.keyIconShadow;
export const KEY_ICON_PRESSED_SHADOW = depth.keyIconPressedShadow;

/** Well: recessed search, composer and segment track (§4). */
export const WELL_SHADOW = depth.wellShadow;

/** Raised segment: the active folder tab (§4). */
export const SEGMENT_GRADIENT = depth.segmentGradient;
export const SEGMENT_SHADOW = depth.segmentShadow;

/** Raised pill: the date separator and big-emoji meta (§4). */
export const PILL_GRADIENT = depth.pillGradient;
export const PILL_SHADOW = depth.pillShadow;

/** Bubble looks (§5). */
export const BUBBLE_OUT_GRADIENT = depth.bubbleOutGradient;
export const BUBBLE_OUT_SHADOW = depth.bubbleOutShadow;
export const BUBBLE_IN_GRADIENT = depth.bubbleInGradient;
export const BUBBLE_IN_SHADOW = depth.bubbleInShadow;
export const BUBBLE_GEN_SHADOW = depth.bubbleGenShadow;

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
