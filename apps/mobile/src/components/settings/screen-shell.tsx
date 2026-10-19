// effect-plain: the settings shell owns no I/O; the pull spinner is a local UI timer over callbacks the screens own.
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View, type RefreshControlProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabScreenBottomPadding } from '@/components/nav/floating-tab-bar';
import { ScreenHeader } from '@/components/ui/screen-header';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { useScrollToTopOnReselect } from '@/lib/tab-reselect';
import { cn } from '@/lib/utils';

/** How long the pull spinner stays up when `onRefresh` returns nothing. */
const REFRESH_FALLBACK_MS = 600;

/**
 * The pull-to-refresh spinner. It stops when the reload returns a promise that
 * settles, and on a short beat when the reload returns nothing (the data hooks'
 * `reload` is synchronous, so there is nothing to await).
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
  right?: ReactNode;
  /** The root tab that scrolls this body to the top when re-tapped. */
  tabName?: string | undefined;
  /** Pull to refresh; the spinner stops when the returned promise settles. */
  onRefresh?: (() => void | Promise<unknown>) | undefined;
  /** A refresh control the screen drives itself, instead of `onRefresh`. */
  refreshControl?: ReactElement<RefreshControlProps> | undefined;
  /** A body that does not scroll, for screens whose child is already a list. */
  scroll?: boolean | undefined;
  /** Dismiss the keyboard on drag and adjust insets for it; off keeps a plain scroll view. */
  keyboardAvoidance?: boolean | undefined;
  contentClassName?: string | undefined;
  contentPaddingBottom?: number | undefined;
  footer?: ReactNode;
  /** Content outside the scroll body, such as a sheet or a fixed note. */
  after?: ReactNode;
  children: ReactNode;
};

export function SettingsScreenShell({
  title,
  subtitle,
  onBack,
  right,
  tabName,
  onRefresh,
  refreshControl,
  scroll = true,
  keyboardAvoidance = true,
  contentClassName = 'p-4',
  contentPaddingBottom,
  footer,
  after,
  children,
}: SettingsScreenShellProps) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const { refreshing, pullToRefresh } = usePullToRefresh(onRefresh);
  useScrollToTopOnReselect(tabName, () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  });
  const refreshControlElement =
    refreshControl ??
    (onRefresh === undefined ? undefined : (
      <RefreshControl
        refreshing={refreshing}
        tintColor={MUTED_FOREGROUND}
        onRefresh={pullToRefresh}
      />
    ));

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
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{
            paddingBottom:
              contentPaddingBottom ?? tabScreenBottomPadding(onBack !== undefined, insets.bottom),
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={keyboardAvoidance ? 'interactive' : 'none'}
          automaticallyAdjustKeyboardInsets={keyboardAvoidance}
          refreshControl={refreshControlElement}
        >
          <View className={contentClassName}>{children}</View>
        </ScrollView>
      ) : (
        <View className={cn('flex-1', contentClassName)}>{children}</View>
      )}
      {footer !== undefined ? (
        <View
          className="flex-row items-center gap-2 border-t border-divider px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          {footer}
        </View>
      ) : null}
      {after}
    </SafeAreaView>
  );
}
