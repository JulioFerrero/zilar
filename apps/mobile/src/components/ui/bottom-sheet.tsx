import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { palette } from '@zilar/ui-tokens';
import { ChevronLeft, X } from 'lucide-react-native';
import { useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { queueSheetTransition } from '@/components/ui/sheet-queue';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { cn } from '@/lib/utils';

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  closeLabel: string;
  title?: string;
  onBack?: () => void;
  headerRight?: ReactNode;
  footer?: ReactNode;
  /**
   * Whether a drag, backdrop tap or Android back may dismiss; a busy sheet passes
   * `false` so a native dismissal cannot desync `visible`.
   */
  dismissible?: boolean;
  /**
   * Lets TrueSheet drive the content scroll view on Android. The library cannot
   * combine this mode with an `auto` detent, so the sheet takes one fixed detent.
   */
  scrollable?: boolean;
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
 * The kit bottom sheet shell on `@lodev09/react-native-true-sheet`: `auto`
 * detents size the panel to its content within `maxHeightClassName`. A long
 * list passes `scrollable`, which needs one fixed detent because the library
 * cannot combine its Android scroll mode with `auto`. The header and footer sit
 * outside the scroll view, the top padding clears the grabber, and
 * `dismissible={false}` keeps a running action from hiding it.
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
  scrollable = false,
  maxHeightClassName = 'max-h-[85%]',
  children,
}: BottomSheetProps) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheet = useRef<TrueSheet>(null);
  const presented = useRef(false);
  const maxHeight = Math.round(height * maxHeightFraction(maxHeightClassName));
  // No title, back key or right keys means no header row, so the content starts at the top.
  const hasHeader = title !== undefined || onBack !== undefined || headerRight !== undefined;

  useEffect(() => {
    const instance = sheet.current;
    if (instance === null) {
      return;
    }
    if (visible) {
      presented.current = true;
      void queueSheetTransition(() => instance.present());
    } else if (presented.current) {
      presented.current = false;
      void queueSheetTransition(() => instance.dismiss());
    }
  }, [visible]);

  return (
    <TrueSheet
      ref={sheet}
      detents={scrollable ? [maxHeightFraction(maxHeightClassName)] : ['auto']}
      scrollable={scrollable}
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
      <View
        className="border-t border-border bg-panel"
        style={scrollable ? { flex: 1 } : { maxHeight }}
      >
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
          style={scrollable ? { flex: 1 } : { flexShrink: 1 }}
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
