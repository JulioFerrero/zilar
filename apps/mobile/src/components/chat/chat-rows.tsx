import { ChatListItem } from '@/components/chat/chat-list-item';
import { GroupListItem } from '@/components/chat/group-list-item';
import type { ChatListRow } from '@/lib/chat-list';

/** The stable list key of one row (chat id, or `group:<groupId>`). */
export function chatRowKey(row: ChatListRow): string {
  return row.kind === 'chat' ? row.chat.id : `group:${row.groupId}`;
}

/**
 * The one Chat/Group row switch (T-0135, deduped in T-1020): a chat row or a
 * group row, wired to the caller's navigation and long-press handlers. The
 * list, the search results and the archived section all render through it.
 */
export function ChatRow({
  row,
  onPressChat,
  onPressGroup,
  onLongPress,
}: {
  row: ChatListRow;
  onPressChat: (chatId: string) => void;
  onPressGroup: (groupId: string) => void;
  onLongPress: (id: string) => void;
}) {
  if (row.kind === 'chat') {
    return (
      <ChatListItem
        chat={row.chat}
        onPress={() => onPressChat(row.chat.id)}
        onLongPress={() => onLongPress(row.chat.id)}
      />
    );
  }
  return (
    <GroupListItem
      groupId={row.groupId}
      onPress={() => onPressGroup(row.groupId)}
      onLongPress={() => onLongPress(`group:${row.groupId}`)}
    />
  );
}
