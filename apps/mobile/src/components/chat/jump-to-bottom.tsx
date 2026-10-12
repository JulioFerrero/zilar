import { ChevronDown } from 'lucide-react-native';
import { View } from 'react-native';

import { CountBadge } from '@/components/ui/count-badge';
import { IconButton } from '@/components/ui/icon-button';
import { ICON } from '@/lib/colors';

type JumpToBottomProps = {
  /** Whether the list is scrolled to (or within 40 px of) the bottom. */
  atBottom: boolean;
  /** New messages that arrived while the user was scrolled up. */
  count: number;
  onPress: () => void;
};

/**
 * The round "jump to latest" key (MUX-8): it sits over the list, bottom-right
 * above the composer, as soon as the user scrolls away from the end. The badge
 * counts the messages that arrived while they were reading; a tap scrolls to
 * the end.
 */
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
