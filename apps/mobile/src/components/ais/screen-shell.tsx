import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabScreenBottomPadding } from '@/components/nav/floating-tab-bar';
import { ScreenHeader } from '@/components/ui/screen-header';

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
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader
        variant={onBack === undefined ? 'root' : 'sub'}
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        right={right}
      />
      {scroll ? (
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
