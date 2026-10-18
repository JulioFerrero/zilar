// effect-plain: no effects
import { X } from 'lucide-react-native';
import { useMemo, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatRow, chatRowKey } from '@/components/chat/chat-rows';
import { MessageSearchList } from '@/components/chat/message-search-list';
import { PeopleListSection } from '@/components/contacts/people-list-section';
import { PeopleSearchResult } from '@/components/contacts/people-search-result';
import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import type { ChatListRow } from '@/lib/chat-list';
import { MUTED_FOREGROUND } from '@/lib/colors';
import type { ContactsApi } from '@/lib/contacts-api';
import { createSearchApi } from '@/lib/search-api';
import { getSessionToken } from '@/lib/session-token';
import type { ChatSummary } from '@/lib/types';
import { mockToken } from '@/mock/gate';

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
  onOpenGroup: (groupId: string) => void;
  chatMatches: ChatListRow[];
  openActions: (id: string) => void;
  messageQuery: string;
  onNotFound: () => void;
  searchMiss: string | null;
}) {
  // The mock branch sits behind a literal build-time condition, so a release
  // build leaves the mock out.
  const searchApi = useMemo(() => {
    if (process.env.NODE_ENV === 'test' || process.env.EXPO_PUBLIC_ZILAR_MOCK === '1') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
      return createSearchApi(mockToken, mockFetch, API_URL);
    }
    return createSearchApi(getSessionToken);
  }, []);
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
          submitRequest={submitRequest}
        />
      ) : (
        <PeopleListSection api={contactsApi} text={search} />
      )}
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

export function ChatPeopleResults({
  searchHeader,
  contactsApi,
  search,
  chats,
  myJid,
  submitRequest,
  onOpenChat,
}: {
  searchHeader: ReactNode;
  contactsApi: ContactsApi;
  search: string;
  chats: ChatSummary[];
  myJid: string | undefined;
  submitRequest: number;
  onOpenChat: (chatId: string) => void;
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
          submitRequest={submitRequest}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
