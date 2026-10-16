import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import type { ContactsApi, HandleProfile } from '@/lib/contacts-api';

import { usePeoplePrefixSearch } from './use-people-prefix-search';

/**
 * The People section above the chat-list "Chats" results (T-1668): for a
 * search text that is not an exact `@handle`, it lists the people whose name
 * or `@username` starts with the 3+ character query. Tapping a row opens
 * `/u/<handle>`. It renders nothing while idle (a query under 3 characters),
 * and one muted line for loading, no results, rate limiting or any failure.
 */
export function PeopleListSection({ api, text }: { api: ContactsApi; text: string }) {
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

/** One person row: avatar, name and `@handle`, like web's `PersonRow`. */
function PersonRow({ entry, onOpen }: { entry: HandleProfile; onOpen: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${entry.name}`}
      onPress={onOpen}
      className="flex-row items-center gap-3 rounded-[12px] px-[10px] py-2 active:bg-surface-raised"
    >
      <EntityAvatar person={entry} size={40} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[14px] font-semibold text-foreground">
          {entry.name}
        </Text>
        <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
          @{entry.handle}
        </Text>
      </View>
    </Pressable>
  );
}
