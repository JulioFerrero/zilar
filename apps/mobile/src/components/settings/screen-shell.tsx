import { ChevronLeft } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON } from '@/lib/colors';

type SettingsScreenShellProps = {
  title: string;
  subtitle?: string | undefined;
  onBack: () => void;
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
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 px-2 py-2">
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={24} color={ICON[scheme]} />
        </IconButton>
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
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View className="p-4">{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}
