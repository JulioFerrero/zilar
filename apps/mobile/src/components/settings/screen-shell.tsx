import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabScreenBottomPadding } from '@/components/nav/floating-tab-bar';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { cn } from '@/lib/utils';

type SettingsScreenShellProps = {
  title: string;
  subtitle?: string | undefined;
  onBack?: (() => void) | undefined;
  /** A header action, e.g. the profile screen's save state. */
  right?: ReactNode;
  children: ReactNode;
};

/** The frame shared by the settings hub and every settings page. */
export function SettingsScreenShell({
  title,
  subtitle,
  onBack,
  right,
  children,
}: SettingsScreenShellProps) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View
        className={cn('flex-row items-center gap-1 py-2', onBack === undefined ? 'px-4' : 'px-2')}
      >
        {onBack === undefined ? null : (
          <IconButton label="Back" onPress={onBack}>
            <ChevronLeft size={24} color={ICON} />
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
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingBottom: tabScreenBottomPadding(onBack !== undefined, insets.bottom),
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View className="p-4">{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}
