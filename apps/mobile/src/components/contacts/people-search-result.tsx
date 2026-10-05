import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { ContactsApi } from '@/lib/contacts-api';

import { ProfileCard } from './profile-card';
import { NO_PERSON_MESSAGE, PEOPLE_RATE_LIMITED_MESSAGE, peopleHandleFor } from './people-search';
import { usePeopleSearch } from './use-people-search';

/**
 * The People section above the chat-list search results (T-0193): when the
 * trimmed search text starts with `@` and the rest is a valid handle, one
 * row for that person — avatar, name, `@handle`, and the action for the
 * relation the lookup returns. An unknown handle shows one muted line; a
 * shorter or invalid handle shows nothing. Tapping the name or the avatar
 * opens `/u/<handle>`.
 */
export function PeopleSearchResult({
  api,
  text,
  chats,
  myJid,
  onMessage,
  onOpenRequests,
  submitRequest,
}: {
  api: ContactsApi;
  text: string;
  /** The loaded chats, to resolve a contact's DM without a refetch. */
  chats: { id: string; kind: string }[];
  /** The viewer's own bare JID, for the DM domain. */
  myJid: string | null | undefined;
  onMessage: (chatId: string) => void;
  onOpenRequests: () => void;
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
        <View className="px-[10px] pb-2">
          <ProfileCard
            profile={view.profile}
            sent={view.sent}
            busy={search.busy}
            error={search.actionError}
            onSend={search.send}
            onCancel={search.cancelRequest}
            onAccept={search.acceptRequest}
            onDecline={search.declineRequest}
            onMessage={search.openMessage}
            onOpenRequests={onOpenRequests}
            onOpenProfile={() =>
              router.push({ pathname: '/u/[handle]', params: { handle: view.profile.handle } })
            }
          />
        </View>
      ) : null}
    </View>
  );
}
