import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/chat/avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useChatStore } from '@/store/chat-store-provider';

/** A topic row reads `Group › Topic`; everything else is just its title. */
function targetLabel(chat: ChatSummary): string {
  return chat.topic !== undefined && chat.groupTitle !== undefined
    ? `${chat.groupTitle} › ${chat.title}`
    : chat.title;
}

/**
 * A channel row is offered only where the caller may post; a plain member (or
 * an unknown role) has no voice in the feed room.
 */
function canPostTo(chat: ChatSummary): boolean {
  if (chat.chatKind !== 'channel') {
    return true;
  }
  return chat.myRole === 'owner' || chat.myRole === 'admin';
}

/**
 * The chats a forward may target, in list order (T-0435, the same rules as
 * web's `ForwardPicker`): archived chats and non-postable channels are never
 * offered, and the query matches `title` and `groupTitle`.
 */
export function forwardTargets(chats: ChatSummary[], query: string): ChatSummary[] {
  const search = query.trim().toLowerCase();
  return chats.filter((chat) => {
    if (chat.archived === true || !canPostTo(chat)) {
      return false;
    }
    if (search.length === 0) {
      return true;
    }
    return (
      chat.title.toLowerCase().includes(search) ||
      (chat.groupTitle !== undefined && chat.groupTitle.toLowerCase().includes(search))
    );
  });
}

/** `Send`, or `Send to N chats` once more than one target is picked. */
export function forwardSendLabel(count: number): string {
  return count > 1 ? `Send to ${count} chats` : 'Send';
}

/**
 * Picks one or more target chats for a forward (T-F part 2, T-0435): the same
 * flow as web's `ForwardPicker`, on a mobile bottom sheet. Several targets are
 * allowed; the optional comment rides along as a separate message per target
 * (the store action already splits it).
 */
export function ForwardSheet({
  messages,
  onClose,
}: {
  messages: UiMessage[];
  onClose: () => void;
}) {
  const chats = useChatStore((state) => state.chats);
  const forwardMessages = useChatStore((state) => state.forwardMessages);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [comment, setComment] = useState('');

  const targets = useMemo(() => forwardTargets(chats, query), [chats, query]);

  const toggle = (chatId: string): void => {
    setSelected((current) =>
      current.includes(chatId) ? current.filter((id) => id !== chatId) : [...current, chatId],
    );
  };

  const send = (): void => {
    if (selected.length === 0) {
      return;
    }
    const trimmed = comment.trim();
    forwardMessages(selected, messages, trimmed === '' ? undefined : { comment: trimmed });
    onClose();
  };

  return (
    <BottomSheet visible onClose={onClose} closeLabel="Close forward" title="Forward">
      <SearchField
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery('')}
        placeholder="Search chats"
        accessibilityLabel="Search chats"
      />
      <View className="mt-2">
        {targets.length === 0 ? (
          <Text className="py-6 text-center text-[14px] text-muted-foreground">No chats found</Text>
        ) : (
          targets.map((chat) => {
            const checked = selected.includes(chat.id);
            const label = targetLabel(chat);
            return (
              <Pressable
                key={chat.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={label}
                onPress={() => toggle(chat.id)}
                className="flex-row items-center gap-3 rounded-lg px-2 py-2 active:bg-surface-raised"
              >
                <Checkbox checked={checked} />
                <Avatar id={chat.id} name={chat.title} size={28} ai={chat.isAI} />
                <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] text-foreground">
                  {label}
                </Text>
              </Pressable>
            );
          })
        )}
      </View>
      <View className="mt-3">
        <TextField
          label="Add a comment (optional)"
          value={comment}
          onChangeText={setComment}
          multiline
        />
      </View>
      <View className="mt-3 flex-row justify-end gap-2">
        <Button variant="outline" onPress={onClose}>
          <Text>Cancel</Text>
        </Button>
        <Button disabled={selected.length === 0} onPress={send}>
          <Text>{forwardSendLabel(selected.length)}</Text>
        </Button>
      </View>
    </BottomSheet>
  );
}
