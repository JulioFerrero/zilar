import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { ContactRelation, ContactsApi } from '@/lib/contacts-api';

import { NO_PERSON_MESSAGE, PEOPLE_RATE_LIMITED_MESSAGE, peopleHandleFor } from './people-search';
import { PersonRow } from './person-row';
import { usePeopleSearch } from './use-people-search';

/**
 * The People section above the chat-list search results (T-0193): when the
 * trimmed search text starts with `@` and the rest is a valid handle, one
 * compact person row — avatar, name, `@handle` and a muted relation hint. An
 * unknown handle shows one muted line; a shorter or invalid handle shows
 * nothing. A contact's row opens the DM, the viewer's own row does nothing,
 * and every other relation opens `/u/<handle>` (T-1854).
 */
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
  /** The loaded chats, to resolve a contact's DM without a refetch. */
  chats: { id: string; kind: string }[];
  /** The viewer's own bare JID, for the DM domain. */
  myJid: string | null | undefined;
  onMessage: (chatId: string) => void;
  /** Bumped by the search field's Enter key to look up at once. */
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

/** The muted right-side hint for the relation, or none. */
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
