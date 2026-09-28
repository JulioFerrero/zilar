import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { FOREGROUND } from '@/lib/colors';

type AisScreenShellProps = {
  title: string;
  subtitle?: string | undefined;
  onBack: () => void;
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
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center px-1.5 py-1">
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={26} color={FOREGROUND[scheme]} />
        </IconButton>
        <View className="ml-0.5 flex-1">
          <Text numberOfLines={1} className="text-[20px] font-semibold text-foreground">
            {title}
          </Text>
          {subtitle !== undefined ? (
            <Text numberOfLines={1} className="text-[14px] text-muted-foreground">
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
        >
          <View className="p-4">{children}</View>
        </ScrollView>
      ) : (
        <View className="flex-1 p-4">{children}</View>
      )}
      {footer !== undefined ? (
        <View className="flex-row items-center gap-2 border-t border-divider px-4 py-3">
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}
