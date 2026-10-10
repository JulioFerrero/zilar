import { Archive, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { TopicRow } from '@/components/chat/topic-row';
import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import { ICON } from '@/lib/colors';
import { ACCENT_FOREGROUND, KEY_PRIMARY_PRESSED_SHADOW, pressStyle, primaryKey } from '@/lib/depth';
import type { ChatSummary } from '@/lib/types';

type GroupTopicListProps = {
  activeTopics: ChatSummary[];
  archivedTopics: ChatSummary[];
  canCreate: boolean;
  onOpenTopic: (chat: ChatSummary) => void;
  onOpenSheet: (chat: ChatSummary) => void;
  onNewTopic: () => void;
};

/**
 * The group topics list: the search field, the active rows plus the shared
 * Archived toggle, and the create FAB. Per-user archived topics hide like
 * manager-archived ones (web parity) behind one Archived toggle at the bottom,
 * never two sections.
 */
export function GroupTopicList({
  activeTopics,
  archivedTopics,
  canCreate,
  onOpenTopic,
  onOpenSheet,
  onNewTopic,
}: GroupTopicListProps) {
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  const [search, setSearch] = useState('');
  const [archivedOpen, setArchivedOpen] = useState(false);

  const query = search.trim().toLowerCase();
  const listed =
    query === ''
      ? activeTopics
      : activeTopics.filter((topic) => topic.title.toLowerCase().includes(query));
  const listedArchived =
    query === ''
      ? archivedTopics
      : archivedTopics.filter((topic) => topic.title.toLowerCase().includes(query));
  const visible = [...listed, ...(archivedOpen ? listedArchived : [])];

  return (
    <>
      <View className="flex-row items-center gap-2 px-4 py-2">
        <SearchField
          containerClassName="flex-1"
          value={search}
          onChangeText={setSearch}
          placeholder="Search topics"
          accessibilityLabel="Search topics"
        />
      </View>

      <FlatList
        className="flex-1"
        data={visible}
        keyExtractor={(chat) => chat.id}
        contentContainerStyle={{ paddingBottom: 96 }}
        renderItem={({ item }) => (
          <TopicRow
            chat={item}
            onPress={() => onOpenTopic(item)}
            onLongPress={() => onOpenSheet(item)}
          />
        )}
        ListEmptyComponent={
          <View className="items-center px-6 pt-16">
            <Text className="text-[15px] text-muted-foreground">No topics found</Text>
          </View>
        }
        ListFooterComponent={
          listedArchived.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                archivedOpen
                  ? 'Hide archived topics'
                  : `Show archived topics, ${listedArchived.length}`
              }
              onPress={() => setArchivedOpen((value) => !value)}
              className="flex-row items-center justify-center gap-1.5 px-4 py-3 active:bg-surface-raised"
            >
              <Archive size={16} color={ICON} />
              <Text className="text-[14px] font-medium text-muted-foreground">
                Archived ({listedArchived.length})
              </Text>
            </Pressable>
          ) : null
        }
      />

      {canCreate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New topic"
          onPress={onNewTopic}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-[18px]"
          style={[primaryKey, pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion)]}
        >
          <Plus size={24} color={ACCENT_FOREGROUND} />
        </Pressable>
      ) : null}
    </>
  );
}
