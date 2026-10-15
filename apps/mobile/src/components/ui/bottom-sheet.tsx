import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { palette } from '@zilar/ui-tokens';
import { ChevronLeft, X } from 'lucide-react-native';
import { useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { runInBackground } from '@/lib/effect/run-in-background';
import { cn } from '@/lib/utils';

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /**
   * The label for the sheet's drag handle (the kit used it for the backdrop).
   * Kept so the call sites don't change; see the T-1348 Report.
   */
  closeLabel: string;
  /** The header title; it also announces the sheet to screen readers. */
  title?: string;
  /** A dark back key on the header's left, when given. */
  onBack?: () => void;
  /** Keys on the header's right. A titled sheet gets the default close key when this is `undefined`; `null` hides it. */
  headerRight?: ReactNode;
  /** A sticky row under the scroll view, kept above the keyboard. */
  footer?: ReactNode;
  /**
   * Whether a drag, a backdrop tap or Android back may dismiss the sheet.
   * Defaults to `true`; a sheet that must not be dismissed mid-action (a busy
   * import) passes `false` so the native dismissal cannot desync `visible`.
   */
  dismissible?: boolean;
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
 * bounded by the same cap and scrolls within it instead. The panel is the D24
 * `panel` colour with a top hairline and the 36×4 grabber (`ui-style.md` §2); the
 * header row (an optional back key, the title, optional right keys) and the
 * `footer` row sit outside the scroll view, so a long body scrolls between them.
 * A titled sheet gets the standard close key on the header's right by default
 * (T-1443); pass `headerRight={null}` to hide it or your own keys to replace it.
 * Pass `dismissible={false}` while an action runs, so a drag, a backdrop tap or
 * Android back cannot hide the sheet while its `visible` stays true.
 * The top padding keeps the header clear of the native grabber, which the
 * library draws inside the sheet's top edge and offers no content inset for.
 */
export function BottomSheet({
  visible,
  onClose,
  closeLabel,
  title,
  onBack,
  headerRight,
  footer,
  dismissible = true,
  maxHeightClassName = 'max-h-[85%]',
  children,
}: BottomSheetProps) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheet = useRef<TrueSheet>(null);
  const presented = useRef(false);
  const maxHeight = Math.round(height * maxHeightFraction(maxHeightClassName));
  // A sheet with no title, back key or right keys shows no header row, so the
  // content starts at the top instead of under an empty block.
  const hasHeader = title !== undefined || onBack !== undefined || headerRight !== undefined;

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
      backgroundColor={palette.panel}
      cornerRadius={16}
      grabber
      grabberOptions={{ width: 36, height: 4, cornerRadius: 2, color: '#333333', adaptive: false }}
      dimmed
      dismissible={dismissible}
      accessibilityOptions={{ grabberLabel: closeLabel }}
      onDidDismiss={() => {
        presented.current = false;
        onClose();
      }}
    >
      <View className="border-t border-border bg-panel" style={{ maxHeight }}>
        {hasHeader ? (
          <View className="flex-row items-center gap-2 px-4 pt-[22px]">
            {onBack !== undefined ? (
              <IconButton label="Back" className="h-9 w-9 rounded-xl" onPress={onBack}>
                <ChevronLeft size={18} color={ICON} />
              </IconButton>
            ) : null}
            <Text
              numberOfLines={1}
              accessibilityRole="header"
              className="min-w-0 flex-1 text-[17px] font-semibold tracking-[-0.02em] text-foreground"
            >
              {title ?? ''}
            </Text>
            {headerRight === undefined ? (
              title !== undefined ? (
                <IconButton label={closeLabel} className="h-9 w-9 rounded-xl" onPress={onClose}>
                  <X size={16} color={ICON} />
                </IconButton>
              ) : null
            ) : (
              headerRight
            )}
          </View>
        ) : null}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ paddingBottom: footer !== undefined ? 12 : 16 }}
          className={cn('px-4', hasHeader ? 'pt-3.5' : 'pt-[22px]')}
        >
          {children}
        </ScrollView>
        {footer !== undefined ? (
          <View
            className="border-t border-border px-4 pt-3"
            style={{ paddingBottom: Math.max(insets.bottom, 34) }}
          >
            {footer}
          </View>
        ) : null}
      </View>
    </TrueSheet>
  );
}
