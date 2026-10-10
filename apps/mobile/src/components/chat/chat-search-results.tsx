// effect-plain: moved unchanged from apps/mobile/src/app/(tabs)/index.tsx (size split)
import { X } from 'lucide-react-native';
import { useMemo, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatRow, chatRowKey } from '@/components/chat/chat-rows';
import { MessageSearchList } from '@/components/chat/message-search-list';
import { PeopleSearchResult } from '@/components/contacts/people-search-result';
import { Text } from '@/components/ui/text';
import type { ChatListRow } from '@/lib/chat-list';
import { MUTED_FOREGROUND } from '@/lib/colors';
import type { ContactsApi } from '@/lib/contacts-api';
import { createSearchApi } from '@/lib/search-api';
import { getSessionToken } from '@/lib/session-token';
import type { ChatSummary } from '@/lib/types';
import { createMockSearchApi } from '@/mock/search';

/**
 * The chats screen's full-screen search results (T-0138, T-0193): the People
 * section when the query is a `@handle`, the matching chat rows, and the
 * message hits below them. The screen owns the search state and shows this
 * instead of the list while a search is open.
 */
export function ChatSearchResults({
  searchHeader,
  searchChat,
  searchChatTitle,
  onClearSearchChat,
  peopleSearch,
  contactsApi,
  search,
  chats,
  myJid,
  submitRequest,
  onOpenChat,
  onOpenRequests,
  onOpenGroup,
  chatMatches,
  openActions,
  messageQuery,
  onNotFound,
  searchMiss,
}: {
  searchHeader: ReactNode;
  searchChat?: string | undefined;
  searchChatTitle?: string | undefined;
  onClearSearchChat: () => void;
  peopleSearch: boolean;
  contactsApi: ContactsApi;
  search: string;
  chats: ChatSummary[];
  myJid: string | undefined;
  submitRequest: number;
  onOpenChat: (chatId: string) => void;
  onOpenRequests: () => void;
  onOpenGroup: (groupId: string) => void;
  chatMatches: ChatListRow[];
  openActions: (id: string) => void;
  messageQuery: string;
  onNotFound: () => void;
  searchMiss: string | null;
}) {
  // The message-search API, real or mock like the store itself: tests run on
  // the mock store (`NODE_ENV=test`), UI work on `EXPO_PUBLIC_ZILAR_MOCK`.
  const searchApi = useMemo(
    () =>
      process.env.NODE_ENV === 'test' || process.env.EXPO_PUBLIC_ZILAR_MOCK === '1'
        ? createMockSearchApi()
        : createSearchApi(getSessionToken),
    [],
  );
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {searchHeader}
      {searchChat !== undefined ? (
        <View className="flex-row items-center px-4 pb-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear chat filter${searchChatTitle === undefined ? '' : `: ${searchChatTitle}`}`}
            onPress={onClearSearchChat}
            className="flex-row items-center gap-1.5 rounded-full bg-surface-raised px-3 py-1.5"
          >
            <Text numberOfLines={1} className="max-w-[240px] text-[12px] text-foreground">
              {searchChatTitle === undefined ? 'This chat only' : `In ${searchChatTitle} only`}
            </Text>
            <X size={12} color={MUTED_FOREGROUND} />
          </Pressable>
        </View>
      ) : null}
      {peopleSearch ? (
        <PeopleSearchResult
          api={contactsApi}
          text={search}
          chats={chats}
          myJid={myJid}
          onMessage={onOpenChat}
          onOpenRequests={onOpenRequests}
          submitRequest={submitRequest}
        />
      ) : null}
      {chatMatches.length > 0 ? (
        <View className="px-2">
          <Text className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">
            Chats
          </Text>
          {chatMatches.map((row) => (
            <ChatRow
              key={chatRowKey(row)}
              row={row}
              onPressChat={onOpenChat}
              onPressGroup={onOpenGroup}
              onLongPress={openActions}
            />
          ))}
        </View>
      ) : null}
      <MessageSearchList
        searchApi={searchApi}
        query={messageQuery}
        {...(searchChat === undefined ? {} : { chatFilter: searchChat })}
        onNotFound={onNotFound}
      />
      {searchMiss !== null ? (
        <View className="px-4 pb-2">
          <Text role="alert" className="text-[13px] text-muted-foreground">
            Message not found
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/**
 * The chats screen's People-only search results (T-0193): a valid `@handle`
 * shows only the People section, since chat names rarely contain `@` and the
 * normal list stays reachable by removing the `@`.
 */
export function ChatPeopleResults({
  searchHeader,
  contactsApi,
  search,
  chats,
  myJid,
  submitRequest,
  onOpenChat,
  onOpenRequests,
}: {
  searchHeader: ReactNode;
  contactsApi: ContactsApi;
  search: string;
  chats: ChatSummary[];
  myJid: string | undefined;
  submitRequest: number;
  onOpenChat: (chatId: string) => void;
  onOpenRequests: () => void;
}) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {searchHeader}
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
        <PeopleSearchResult
          api={contactsApi}
          text={search}
          chats={chats}
          myJid={myJid}
          onMessage={onOpenChat}
          onOpenRequests={onOpenRequests}
          submitRequest={submitRequest}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
