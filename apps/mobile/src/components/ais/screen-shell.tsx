import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON } from '@/lib/colors';
import { cn } from '@/lib/utils';

type AisScreenShellProps = {
  title: string;
  subtitle?: string | undefined;
  onBack?: (() => void) | undefined;
  /** A header action, e.g. the list's "Create AI" button. */
  right?: ReactNode;
  /** Scrolls the body and keeps `footer` pinned above the keyboard. */
  scroll?: boolean;
  footer?: ReactNode;
  children: ReactNode;
};

/** The frame shared by the My AIs, Create and Edit screens. */
export function AisScreenShell({
  title,
  subtitle,
  onBack,
  right,
  scroll = false,
  footer,
  children,
}: AisScreenShellProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View
        className={cn('flex-row items-center gap-1 py-2', onBack === undefined ? 'px-4' : 'px-2')}
      >
        {onBack === undefined ? null : (
          <IconButton label="Back" onPress={onBack}>
            <ChevronLeft size={24} color={ICON[scheme]} />
          </IconButton>
        )}
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[20px] font-semibold leading-6 text-foreground">
            {title}
          </Text>
          {subtitle !== undefined ? (
            <Text numberOfLines={1} className="mt-0.5 text-[14px] leading-5 text-muted-foreground">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          <View className="p-4">{children}</View>
        </ScrollView>
      ) : (
        <View className="flex-1 p-4">{children}</View>
      )}
      {footer !== undefined ? (
        <View
          className="flex-row items-center gap-2 border-t border-divider px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}
