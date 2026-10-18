import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { cn } from '@/lib/utils';

export type ScreenHeaderProps = {
  variant: 'root' | 'sub';
  title: string;
  /** One muted line under the title. Not drawn when `bare`. */
  subtitle?: string | undefined;
  /** A sub-screen's back key. Required for app-chrome sub-screens. */
  onBack?: (() => void) | undefined;
  /** A 40 px key or a small text button at the right end of the nav row. */
  right?: ReactNode;
  /** Sub only: draw the 56 px nav row and let the body own the title. */
  bare?: boolean | undefined;
  testID?: string | undefined;
};

const TITLE_CLASS = 'text-[28px] font-semibold leading-9 tracking-[-0.02em] text-foreground';

/**
 * The phone header shared by the root tabs and every pushed screen (T-1948).
 * The caller owns the safe area.
 */
export function ScreenHeader({
  variant,
  title,
  subtitle,
  onBack,
  right,
  bare = false,
  testID,
}: ScreenHeaderProps) {
  if (variant === 'root') {
    return (
      <View testID={testID} className="flex-row items-center gap-1 px-4 pt-2 pb-2">
        <Text
          numberOfLines={1}
          accessibilityRole="header"
          className={cn('min-w-0 flex-1', TITLE_CLASS)}
        >
          {title}
        </Text>
        {right}
      </View>
    );
  }

  return (
    <View testID={testID}>
      <View className="h-14 flex-row items-center justify-between pl-1 pr-4">
        {onBack === undefined ? null : (
          <IconButton label="Back" onPress={onBack}>
            <ChevronLeft size={24} color={ICON} />
          </IconButton>
        )}
        {right}
      </View>
      {bare ? null : (
        <View className="mx-4 mt-1 mb-4">
          <Text numberOfLines={1} accessibilityRole="header" className={TITLE_CLASS}>
            {title}
          </Text>
          {subtitle === undefined ? null : (
            <Text numberOfLines={1} className="mt-0.5 text-[14px] leading-5 text-muted-foreground">
              {subtitle}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
