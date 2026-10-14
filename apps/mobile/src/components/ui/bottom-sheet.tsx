import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { palette } from '@zilar/ui-tokens';
import { useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';

import { Text } from '@/components/ui/text';
import { runInBackground } from '@/lib/effect/run-in-background';

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /**
   * The label for the sheet's drag handle (the kit used it for the backdrop).
   * Kept so the call sites don't change; see the T-1348 Report.
   */
  closeLabel: string;
  /** A plain title row above the scrollable content, when given. */
  title?: string;
  /** A `max-h-[NN%]` class; the panel is capped at that share of the screen. */
  maxHeightClassName?: string;
  children?: ReactNode;
};

const DEFAULT_MAX_HEIGHT_FRACTION = 0.85;

/** Reads `max-h-[70%]` → `0.7`; anything else falls back to 85%. */
function maxHeightFraction(className: string): number {
  const match = /\[(\d+(?:\.\d+)?)%\]/.exec(className);
  const fraction = match ? Number(match[1]) / 100 : Number.NaN;
  return fraction > 0 && fraction <= 1 ? fraction : DEFAULT_MAX_HEIGHT_FRACTION;
}

/**
 * The kit bottom sheet shell (T-0313; rebuilt on `@lodev09/react-native-true-sheet`
 * in T-1348). It is the platform's own sheet — iOS `UISheetPresentationController`,
 * Android `BottomSheetDialog` — so it slides up, drags down to close, dims the
 * backdrop (a tap outside closes it) and keeps text inputs above the keyboard
 * natively. `visible` drives `present()` / `dismiss()`; `onDidDismiss` reports a
 * native dismissal (drag, backdrop tap, Android back) back to `onClose`.
 *
 * `detents={['auto']}` sizes the panel to its content, capped at the share of
 * the screen named by `maxHeightClassName` (via `maxContentHeight`). The library
 * does not support `auto` together with its `scrollable` mode, so the content is
 * bounded by the same cap and scrolls within it instead. The content's top
 * padding (`pt-6`) keeps its first row clear of the native grabber, which the
 * library draws inside the sheet's top edge and offers no content inset for.
 */
export function BottomSheet({
  visible,
  onClose,
  closeLabel,
  title,
  maxHeightClassName = 'max-h-[85%]',
  children,
}: BottomSheetProps) {
  const { height } = useWindowDimensions();
  const sheet = useRef<TrueSheet>(null);
  const presented = useRef(false);
  const maxHeight = Math.round(height * maxHeightFraction(maxHeightClassName));

  useEffect(() => {
    const instance = sheet.current;
    if (instance === null) {
      return;
    }
    if (visible) {
      presented.current = true;
      runInBackground(() => instance.present(), {});
    } else if (presented.current) {
      presented.current = false;
      runInBackground(() => instance.dismiss(), {});
    }
  }, [visible]);

  return (
    <TrueSheet
      ref={sheet}
      detents={['auto']}
      maxContentHeight={maxHeight}
      backgroundColor={palette.surface}
      cornerRadius={16}
      grabber
      dimmed
      dismissible
      accessibilityOptions={{ grabberLabel: closeLabel }}
      onDidDismiss={() => {
        presented.current = false;
        onClose();
      }}
    >
      <View
        className="border-t border-border-strong bg-surface px-4 pt-6"
        style={{ maxHeight, paddingBottom: 16 }}
      >
        <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {title !== undefined ? (
            <Text accessibilityRole="header" className="text-[18px] font-semibold text-foreground">
              {title}
            </Text>
          ) : null}
          {children}
        </ScrollView>
      </View>
    </TrueSheet>
  );
}
