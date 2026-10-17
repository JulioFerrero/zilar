import type { ChatSummary } from '@zilar/chat-core';
import { Check } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import { FOREGROUND } from '@/lib/colors';

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
 * The chats a picker may target, in list order (T-0435, the same rules as
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

type ChatPickerMode = 'multi' | 'single';

/**
 * The search field and chat rows shared by Forward (many targets) and the
 * `/share` screen (one target). It owns the query; the caller owns the pick.
 * `multi` rows carry a checkbox, `single` rows a trailing check on the picked
 * one, and both report every tap through `onToggle`.
 */
export function ChatPickerList({
  chats,
  selected,
  onToggle,
  mode,
}: {
  chats: ChatSummary[];
  selected: readonly string[];
  onToggle: (chatId: string) => void;
  mode: ChatPickerMode;
}) {
  const [query, setQuery] = useState('');
  const targets = useMemo(() => forwardTargets(chats, query), [chats, query]);

  return (
    <>
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
            const picked = selected.includes(chat.id);
            const label = targetLabel(chat);
            return (
              <Pressable
                key={chat.id}
                accessibilityRole={mode === 'multi' ? 'checkbox' : 'radio'}
                accessibilityState={mode === 'multi' ? { checked: picked } : { selected: picked }}
                accessibilityLabel={label}
                onPress={() => onToggle(chat.id)}
                className="flex-row items-center gap-3 rounded-lg px-2 py-2 active:bg-surface-raised"
              >
                {mode === 'multi' ? <Checkbox checked={picked} /> : null}
                <EntityAvatar chat={chat} size={28} ai={chat.isAI} />
                <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] text-foreground">
                  {label}
                </Text>
                {mode === 'single' && picked ? <Check size={18} color={FOREGROUND} /> : null}
              </Pressable>
            );
          })
        )}
      </View>
    </>
  );
}
