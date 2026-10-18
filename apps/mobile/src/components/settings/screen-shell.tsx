import type { ReactNode } from 'react';
import { useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabScreenBottomPadding } from '@/components/nav/floating-tab-bar';
import { ScreenHeader } from '@/components/ui/screen-header';
import { useScrollToTopOnReselect } from '@/lib/tab-reselect';

type SettingsScreenShellProps = {
  title: string;
  subtitle?: string | undefined;
  onBack?: (() => void) | undefined;
  /** A header action, e.g. the profile screen's save state. */
  right?: ReactNode;
  /** T-1969: the root tab that scrolls this body to the top when re-tapped. */
  tabName?: string | undefined;
  children: ReactNode;
};

/** The frame shared by the settings hub and every settings page. */
export function SettingsScreenShell({
  title,
  subtitle,
  onBack,
  right,
  tabName,
  children,
}: SettingsScreenShellProps) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTopOnReselect(tabName, () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  });
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader
        variant={onBack === undefined ? 'root' : 'sub'}
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        right={right}
      />
      <ScrollView
        ref={scrollRef}
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
