import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { ContactsApi } from '@/lib/contacts-api';

import { PersonRow } from './person-row';
import { usePeoplePrefixSearch } from './use-people-prefix-search';

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
