import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { ContactRelation, ContactsApi } from '@/lib/contacts-api';

import {
  NO_PERSON_MESSAGE,
  PEOPLE_RATE_LIMITED_MESSAGE,
  peopleHandleFor,
} from '@zilar/client-core';
import { PersonRow } from './person-row';
import { usePeopleSearch } from './use-people-search';

export function PeopleSearchResult({
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
