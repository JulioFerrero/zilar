// effect-plain: the settings shell owns no I/O; the pull spinner is a local UI timer over callbacks the screens own.
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabScreenBottomPadding } from '@/components/nav/floating-tab-bar';
import { ScreenHeader } from '@/components/ui/screen-header';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { useScrollToTopOnReselect } from '@/lib/tab-reselect';

/** T-1971: how long the pull spinner stays up when `onRefresh` returns nothing. */
const REFRESH_FALLBACK_MS = 600;

/**
 * T-1971: the pull-to-refresh spinner. It stops when the reload returns a
 * promise that settles, and on a short beat when the reload returns nothing
 * (the data hooks' `reload` is synchronous, so there is nothing to await).
 */
export function usePullToRefresh(onRefresh: (() => void | Promise<unknown>) | undefined): {
  refreshing: boolean;
  pullToRefresh: () => void;
} {
  const [refreshing, setRefreshing] = useState(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);

  useEffect(
    () => () => {
      if (stopTimer.current !== null) {
        clearTimeout(stopTimer.current);
      }
    },
    [],
  );

  const pullToRefresh = (): void => {
    if (onRefresh === undefined || active.current) {
      return;
    }
    active.current = true;
    setRefreshing(true);
    const stop = (): void => {
      active.current = false;
      if (stopTimer.current !== null) {
        clearTimeout(stopTimer.current);
        stopTimer.current = null;
      }
      setRefreshing(false);
    };
    let result: void | Promise<unknown>;
    try {
      result = onRefresh();
    } catch (error) {
      // A synchronous throw must not pin the spinner or the in-flight guard.
      stop();
      throw error;
    }
    if (result === undefined) {
      stopTimer.current = setTimeout(stop, REFRESH_FALLBACK_MS);
      return;
    }
    void result.then(stop, stop);
  };

  return { refreshing, pullToRefresh };
}

type SettingsScreenShellProps = {
  title: string;
  subtitle?: string | undefined;
  onBack?: (() => void) | undefined;
  /** A header action, e.g. the profile screen's save state. */
  right?: ReactNode;
  /** T-1969: the root tab that scrolls this body to the top when re-tapped. */
  tabName?: string | undefined;
  /** T-1971: pull to refresh; the spinner stops when the returned promise settles. */
  onRefresh?: (() => void | Promise<unknown>) | undefined;
  children: ReactNode;
};

/** The frame shared by the settings hub and every settings page. */
export function SettingsScreenShell({
  title,
  subtitle,
  onBack,
  right,
  tabName,
  onRefresh,
  children,
}: SettingsScreenShellProps) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const { refreshing, pullToRefresh } = usePullToRefresh(onRefresh);
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
        refreshControl={
          onRefresh === undefined ? undefined : (
            <RefreshControl
              refreshing={refreshing}
              tintColor={MUTED_FOREGROUND}
              onRefresh={pullToRefresh}
            />
          )
        }
      >
        <View className="p-4">{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}
