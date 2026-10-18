import { Archive, Hash, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { TopicRow } from '@/components/chat/topic-row';
import { SearchField } from '@/components/ui/search-field';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { ACCENT_FOREGROUND, KEY_PRIMARY_PRESSED_SHADOW, pressStyle, primaryKey } from '@/lib/depth';
import type { ChatSummary } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';

type GroupTopicListProps = {
  activeTopics: ChatSummary[];
  archivedTopics: ChatSummary[];
  canCreate: boolean;
  onOpenTopic: (chat: ChatSummary) => void;
  onOpenSheet: (chat: ChatSummary) => void;
  onNewTopic: () => void;
};

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
  const refreshGroupDetail = useChatStore((state) => state.refreshGroupDetail);
  const reloadChats = useChatStore((state) => state.reloadChats);
  const chatsLoad = useChatStore((state) => state.chatsLoad);
  const [refreshing, setRefreshing] = useState(false);

  const groupId = (activeTopics[0] ?? archivedTopics[0])?.groupId;
  const [lastChatsLoad, setLastChatsLoad] = useState(chatsLoad);
  if (chatsLoad !== lastChatsLoad) {
    setLastChatsLoad(chatsLoad);
    if (refreshing && chatsLoad !== 'loading') {
      setRefreshing(false);
    }
  }
  const onRefresh = (): void => {
    setRefreshing(true);
    if (groupId !== undefined) {
      refreshGroupDetail(groupId);
    }
    reloadChats();
  };

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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={MUTED_FOREGROUND}
            onRefresh={onRefresh}
          />
        }
        renderItem={({ item }) => (
          <TopicRow
            chat={item}
            onPress={() => onOpenTopic(item)}
            onLongPress={() => onOpenSheet(item)}
          />
        )}
        ListEmptyComponent={
          <StateMessage
            kind="empty"
            icon={Hash}
            title="No topics found"
            hint={canCreate ? 'Create a topic to get started.' : 'This group has no topics yet.'}
            action={canCreate ? { label: 'New topic', onPress: onNewTopic } : undefined}
          />
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
