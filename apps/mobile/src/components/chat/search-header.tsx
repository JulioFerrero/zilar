import { Search } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { well } from '@/lib/depth';

/**
 * The chats screen's header (T-0138): the title and search well when the
 * search is closed, the autofocused search field with its Cancel button when
 * it is open. The screen owns the search state and the branches it drives.
 */
export function SearchHeader({
  searchOpen,
  search,
  onChange,
  onSubmit,
  onOpen,
  onCancel,
}: {
  searchOpen: boolean;
  search: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onOpen: () => void;
  onCancel: () => void;
}) {
  if (searchOpen) {
    return (
      <View className="flex-row items-center gap-3 px-4 py-2">
        <SearchField
          containerClassName="flex-1"
          autoFocus
          value={search}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          placeholder="Search, or type @username"
          accessibilityLabel="Search chats, messages and people"
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          onClear={() => onChange('')}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel search" onPress={onCancel}>
          <Text className="text-[15px] text-foreground">Cancel</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View className="gap-2 px-4 py-2">
      <Text className="text-[28px] font-semibold leading-9 tracking-[-0.02em] text-foreground">
        Chats
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search chats and @usernames"
        onPress={onOpen}
        className="h-10 flex-row items-center gap-2 rounded-xl px-3"
        style={well}
      >
        <Search size={16} color={MUTED_FOREGROUND} />
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          className="flex-1 text-[15px]"
          style={{ color: MUTED_FOREGROUND }}
        >
          Search chats and @usernames
        </Text>
      </Pressable>
    </View>
  );
}
