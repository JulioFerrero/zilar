import { ChevronDown } from 'lucide-react-native';
import { View } from 'react-native';

import { CountBadge } from '@/components/ui/count-badge';
import { IconButton } from '@/components/ui/icon-button';
import { ICON } from '@/lib/colors';

type JumpToBottomProps = {
  /** Whether the list is scrolled to (or within 40 px of) the bottom. */
  atBottom: boolean;
  count: number;
  onPress: () => void;
};

export function JumpToBottom({ atBottom, count, onPress }: JumpToBottomProps) {
  if (atBottom) {
    return null;
  }
  return (
    <View className="absolute right-3 bottom-3">
      <IconButton
        label="Jump to latest messages"
        className="h-11 w-11 rounded-full"
        onPress={onPress}
      >
        <ChevronDown size={22} color={ICON} />
      </IconButton>
      {count > 0 ? (
        <View className="absolute -top-1 -right-1">
          <CountBadge count={count} />
        </View>
      ) : null}
    </View>
  );
}
