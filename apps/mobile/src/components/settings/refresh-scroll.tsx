import { RefreshControl, ScrollView, type ScrollViewProps } from 'react-native';

import { MUTED_FOREGROUND } from '@/lib/colors';

type RefreshScrollProps = Omit<ScrollViewProps, 'refreshControl'> & {
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
};

export function RefreshScroll({
  refreshing,
  onRefresh,
  className = 'flex-1',
  contentContainerStyle = { paddingBottom: 32 },
  keyboardShouldPersistTaps = 'handled',
  keyboardDismissMode = 'interactive',
  automaticallyAdjustKeyboardInsets = true,
  ...props
}: RefreshScrollProps) {
  return (
    <ScrollView
      className={className}
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode={keyboardDismissMode}
      automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={MUTED_FOREGROUND}
          onRefresh={onRefresh}
        />
      }
      {...props}
    />
  );
}
