import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * T-0254: the create sheets in `new-chat-button.tsx` need the keyboard's height
 * to pad their scroll content on Android, where the window no longer resizes
 * for the keyboard (edge-to-edge, Expo SDK 57) and a sheet taller than the free
 * space would hide its last field and Create behind the keyboard.
 *
 * The pure part lives in `keyboardHeightFromEvent` so it can be tested without a
 * renderer; the hook wires it to React Native's keyboard events.
 */

/** The shape of the `keyboardDidShow` event we read (React Native's `KeyboardEvent`). */
export interface KeyboardShowEvent {
  endCoordinates: { height: number };
}

/** Reads the keyboard height (dp) out of a `keyboardDidShow` event. */
export function keyboardHeightFromEvent(event: KeyboardShowEvent): number {
  return event.endCoordinates.height;
}

/**
 * T-0310 (moved from `invite-links-sheet.tsx`, T-0299 follows T-0254): the
 * bottom padding of the invite links and visibility sheets. On Android the
 * window no longer resizes for the keyboard (edge-to-edge, Expo SDK 57), so
 * the sheet is padded by the keyboard height on top of the safe area
 * minimum, letting the form, Save/Create button and content scroll into
 * view. On iOS `KeyboardAvoidingView` keeps its own `padding` behaviour.
 */
export function sheetBottomPadding(
  platform: string,
  insetBottom: number,
  keyboardHeight: number,
): number {
  const base = Math.max(insetBottom, 16);
  return platform === 'android' ? base + keyboardHeight : base;
}

/** The keyboard's height in dp while it is open, 0 while it is hidden. */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setHeight(keyboardHeightFromEvent(event));
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
