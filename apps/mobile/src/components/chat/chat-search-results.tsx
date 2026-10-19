// effect-plain: no effects
import { X } from 'lucide-react-native';
import { useMemo, type ReactNode, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  usePeoplePrefixSearch as useSharedPeoplePrefixSearch,
  type PeopleSearchState,
  NO_PERSON_MESSAGE,
  PEOPLE_RATE_LIMITED_MESSAGE,
  peopleHandleFor,
  usePeopleHandleSearch,
  type PeopleSearchView,
} from '@zilar/client-core';

import { ChatRow, chatRowKey } from '@/components/chat/chat-rows';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { MessageSearchList } from '@/components/chat/message-search-list';
import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import type { ChatListRow } from '@/lib/chat-list';
import { MUTED_FOREGROUND } from '@/lib/colors';
import {
  type ContactsApi,
  type HandleProfile,
  type ContactRelation,
  domainOfJid,
} from '@/lib/contacts-api';
import { apiCall, type ApiTransport } from '@/lib/effect/api-client';
import { makeSearchApi } from '@/lib/search-api';
import { realApiTransport } from '@/lib/use-mockable-api';
import type { ChatSummary } from '@/lib/types';
import { mockToken } from '@/mock/gate';
import { resolveContactChat } from '../contacts/add-contact';

function usePeopleSearch(options: {
  api: ContactsApi;
  text: string;
  chats: { id: string; kind: string }[];
  myJid: string | null | undefined;
  onMessage: (chatId: string) => void;
  submitRequest?: number | undefined;
}): {
  view: PeopleSearchView<HandleProfile>;
  actionError: string | null;
  openMessage: () => void;
} {
  const { api, text, chats, myJid, onMessage, submitRequest } = options;
  const { view, target } = usePeopleHandleSearch<HandleProfile>(
    (handle) => api.lookupByHandle(handle),
    text,
    submitRequest,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  return {
    view,
    actionError,
    openMessage: () => {
      if (target === null) {
        return;
      }
      const chatId = resolveContactChat(chats, target.userId, domainOfJid(myJid));
      if (chatId === undefined) {
        setActionError('No chat with them yet. Pull to refresh the chats list.');
        return;
      }
      onMessage(chatId);
    },
  };
}

function PeopleSearchResult({
  api,
  text,
  chats,
  myJid,
  onMessage,
  submitRequest,
}: {
  api: ContactsApi;
  text: string;
  chats: { id: string; kind: string }[];
  myJid: string | null | undefined;
  onMessage: (chatId: string) => void;
  submitRequest?: number | undefined;
}) {
  const router = useRouter();
  const search = usePeopleSearch({ api, text, chats, myJid, onMessage, submitRequest });
  if (peopleHandleFor(text) === null) {
    return null;
  }
  const view = search.view;
  if (view.status === 'idle') {
    return null;
  }

  return (
    <View className="flex-col gap-0.5 px-2">
      <Text className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">People</Text>
      {view.status === 'looking' ? (
        <Text className="px-[10px] pb-2 text-[13px] text-muted-foreground">Looking up…</Text>
      ) : null}
      {view.status === 'missing' ? (
        <Text className="px-[10px] pb-2 text-[13px] text-muted-foreground">
          {NO_PERSON_MESSAGE}
        </Text>
      ) : null}
      {view.status === 'rateLimited' ? (
        <Text accessibilityRole="alert" className="px-[10px] pb-2 text-[13px] text-danger">
          {PEOPLE_RATE_LIMITED_MESSAGE}
        </Text>
      ) : null}
      {view.status === 'error' ? (
        <Text accessibilityRole="alert" className="px-[10px] pb-2 text-[13px] text-danger">
          {view.message}
        </Text>
      ) : null}
      {view.status === 'found' ? (
        <View className="pb-2">
          <PersonRow
            entry={view.profile}
            hint={relationHint(view.profile.relation)}
            onOpen={
              view.profile.relation === 'self'
                ? undefined
                : view.profile.relation === 'contact'
                  ? search.openMessage
                  : () =>
                      router.push({
                        pathname: '/u/[handle]',
                        params: { handle: view.profile.handle },
                      })
            }
          />
          {search.actionError === null ? null : (
            <Text accessibilityRole="alert" className="px-[10px] text-[13px] text-danger">
              {search.actionError}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function relationHint(relation: ContactRelation): string | undefined {
  switch (relation) {
    case 'request_sent':
      return 'Requested';
    case 'request_received':
      return 'Wants to connect';
    case 'blocked':
      return 'Blocked';
    case 'self':
      return 'You';
    default:
      return undefined;
  }
}

type PeoplePrefixSearchState = PeopleSearchState<HandleProfile>;

function usePeoplePrefixSearch(api: ContactsApi, query: string): PeoplePrefixSearchState {
  return useSharedPeoplePrefixSearch((q) => api.searchUsers(q), query).state;
}

function PeopleListSection({ api, text }: { api: ContactsApi; text: string }) {
  const router = useRouter();
  const state = usePeoplePrefixSearch(api, text);
  if (state.status === 'idle') {
    return null;
  }

  return (
    <View className="flex-col gap-0.5 px-2">
      <Text className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">People</Text>
      {state.status === 'loading' ? (
        <Text className="px-[10px] pb-2 text-[13px] text-muted-foreground">Searching…</Text>
      ) : null}
      {state.status === 'results' && state.entries.length === 0 ? (
        <Text className="px-[10px] pb-2 text-[13px] text-muted-foreground">No people found.</Text>
      ) : null}
      {state.status === 'rate_limited' ? (
        <Text accessibilityRole="alert" className="px-[10px] pb-2 text-[13px] text-danger">
          Too many searches, try again in a few minutes.
        </Text>
      ) : null}
      {state.status === 'error' ? (
        <Text accessibilityRole="alert" className="px-[10px] pb-2 text-[13px] text-danger">
          Could not search people. Try again.
        </Text>
      ) : null}
      {state.status === 'results'
        ? state.entries.map((entry) => (
            <PersonRow
              key={entry.userId}
              entry={entry}
              onOpen={() =>
                router.push({ pathname: '/u/[handle]', params: { handle: entry.handle } })
              }
            />
          ))
        : null}
    </View>
  );
}

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
      const transport: ApiTransport = {
        getToken: mockToken,
        fetchImpl: mockFetch,
        apiUrl: API_URL,
      };
      return makeSearchApi(apiCall(transport), transport);
    }
    return makeSearchApi(apiCall(realApiTransport), realApiTransport);
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

function PersonRow({
  entry,
  hint,
  onOpen,
}: {
  entry: HandleProfile;
  hint?: string | undefined;
  onOpen?: (() => void) | undefined;
}) {
  const content = (
    <>
      <EntityAvatar person={entry} size={40} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[14px] font-semibold text-foreground">
          {entry.name}
        </Text>
        <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
          @{entry.handle}
        </Text>
      </View>
      {hint === undefined ? null : (
        <Text numberOfLines={1} className="shrink-0 text-[12px] text-muted-foreground">
          {hint}
        </Text>
      )}
    </>
  );

  if (onOpen === undefined) {
    return <View className="flex-row items-center gap-3 px-[10px] py-2">{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${entry.name}`}
      onPress={onOpen}
      className="flex-row items-center gap-3 rounded-[12px] px-[10px] py-2 active:bg-surface-raised"
    >
      {content}
    </Pressable>
  );
}
