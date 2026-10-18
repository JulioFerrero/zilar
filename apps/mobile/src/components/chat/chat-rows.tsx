import { useMemo, type RefObject } from 'react';
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { ChatListItem } from '@/components/chat/chat-list-item';
import { ChatRowSwipe } from '@/components/chat/chat-row-swipe';
import { GroupListItem } from '@/components/chat/group-list-item';
import type { ChatListRow } from '@/lib/chat-list';
import type { PutChatPrefInput } from '@/lib/chat-prefs-api';
import { topicsOfGroup } from '@/lib/topics';
import { useChatStore } from '@/store/chat-store-provider';

export function chatRowKey(row: ChatListRow): string {
  return row.kind === 'chat' ? row.chat.id : `group:${row.groupId}`;
}

export function ChatRow({
  row,
  onPressChat,
  onPressGroup,
  onLongPress,
  onPref,
  openSwipeRef,
}: {
  row: ChatListRow;
  onPressChat: (chatId: string) => void;
  onPressGroup: (groupId: string) => void;
  onLongPress: (id: string) => void;
  onPref?: ((chatId: string, input: PutChatPrefInput) => void) | undefined;
  openSwipeRef?: RefObject<SwipeableMethods | null> | undefined;
}) {
  if (row.kind === 'chat') {
    const item = (
      <ChatListItem
        chat={row.chat}
        onPress={() => onPressChat(row.chat.id)}
        onLongPress={() => onLongPress(row.chat.id)}
      />
    );
    if (onPref === undefined || openSwipeRef === undefined) {
      return item;
    }
    return (
      <ChatRowSwipe chat={row.chat} onPref={onPref} openRef={openSwipeRef}>
        {item}
      </ChatRowSwipe>
    );
  }
  return (
    <GroupRow
      groupId={row.groupId}
      onPressGroup={onPressGroup}
      onLongPress={onLongPress}
      onPref={onPref}
      openSwipeRef={openSwipeRef}
    />
  );
}

function GroupRow({
  groupId,
  onPressGroup,
  onLongPress,
  onPref,
  openSwipeRef,
}: {
  groupId: string;
  onPressGroup: (groupId: string) => void;
  onLongPress: (id: string) => void;
  onPref: ((chatId: string, input: PutChatPrefInput) => void) | undefined;
  openSwipeRef: RefObject<SwipeableMethods | null> | undefined;
}) {
  const chats = useChatStore((state) => state.chats);
  const topics = useMemo(() => topicsOfGroup(chats, groupId), [chats, groupId]);
  const row = (
    <GroupListItem
      groupId={groupId}
      onPress={() => onPressGroup(groupId)}
      onLongPress={() => onLongPress(`group:${groupId}`)}
    />
  );
  if (onPref === undefined || openSwipeRef === undefined) {
    return row;
  }
  const general = topics.find((topic) => topic.topic?.isGeneral === true);
  if (general === undefined) {
    return row;
  }
  return (
    <ChatRowSwipe chat={general} onPref={onPref} openRef={openSwipeRef}>
      {row}
    </ChatRowSwipe>
  );
}
