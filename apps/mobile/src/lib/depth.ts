import type { ViewStyle } from 'react-native';

import { depth, palette } from '@zilar/ui-tokens';

/**
 * The depth recipes from docs/design/ui-style.md §4 and the bubble looks from §5. Every shadow and gradient string lives here once; components apply them, never ad hoc.
 */

export const ACCENT = palette.accent;
export const ACCENT_FOREGROUND = palette.accentForeground;
export const EDGE = palette.edge;
export const BORDER = palette.border;
export const BORDER_STRONG = palette.borderStrong;
export const WELL_BACKGROUND = palette.well;
export const ICON_COLOR = palette.iconColor;

export const KEY_PRIMARY_GRADIENT = depth.keyPrimaryGradient;
export const KEY_PRIMARY_SHADOW = depth.keyPrimaryShadow;
export const KEY_PRIMARY_PRESSED_SHADOW = depth.keyPrimaryPressedShadow;

export const KEY_ICON_GRADIENT = depth.keyIconGradient;
export const KEY_ICON_SHADOW = depth.keyIconShadow;
export const KEY_ICON_PRESSED_SHADOW = depth.keyIconPressedShadow;

export const WELL_SHADOW = depth.wellShadow;

export const SEGMENT_GRADIENT = depth.segmentGradient;
export const SEGMENT_SHADOW = depth.segmentShadow;

export const PILL_GRADIENT = depth.pillGradient;
export const PILL_SHADOW = depth.pillShadow;

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
