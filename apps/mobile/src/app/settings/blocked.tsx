import { Effect } from 'effect';
import { useRouter } from 'expo-router';
import { Ban } from 'lucide-react-native';
import { RefreshControl, View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { useFocusList } from '@/components/settings/use-focus-list';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { blockedLoadFailure, performUnblock } from '@/components/contacts/blocks';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { useAction } from '@/lib/effect/use-action';
import { isWaiting } from '@zilar/client-core';
import type { BlockedPerson } from '@zilar/client-core';

type PageStatus = 'loading' | 'ready' | 'error';

export default function BlockedScreen() {
  return (
    <RequireAuth>
      <BlockedList />
    </RequireAuth>
  );
}

function BlockedList() {
  const router = useRouter();
  const { api, mock } = useContactsApi();

  const list = useFocusList<BlockedPerson[]>(() =>
    Effect.tryPromise({
      try: () => api.listBlockedUsers(),
      catch: (loadError: unknown) => blockedLoadFailure(loadError),
    }),
  );
  const status: PageStatus = list.status;
  const people = list.data ?? [];
  const { setData, setError, refreshing, refresh } = list;
  const error = list.error ?? '';

  // A failure keeps the row and shows the fixed sentence; the row's own action stops a double tap.
  const unblock = (userId: string): Effect.Effect<void> =>
    Effect.sync(() => setError('')).pipe(
      Effect.andThen(
        Effect.promise(() =>
          performUnblock(api, userId, () => {
            setData((rows) => rows?.filter((row) => row.userId !== userId));
          }),
        ),
      ),
      Effect.tap((failure) =>
        Effect.sync(() => {
          if (failure !== null) {
            setError(failure);
          }
        }),
      ),
      Effect.asVoid,
    );

  return (
    <SettingsScreenShell
      title="Blocked people"
      subtitle="They are not told."
      onBack={() => router.back()}
      contentClassName="p-4"
      contentPaddingBottom={32}
      refreshControl={
        <RefreshControl refreshing={refreshing} tintColor={MUTED_FOREGROUND} onRefresh={refresh} />
      }
      after={
        mock ? (
          <View className="items-center border-t border-divider px-4 py-1">
            <Text className="text-[12px] text-muted-foreground">Mock data</Text>
          </View>
        ) : null
      }
    >
      {status === 'loading' ? (
        <StateMessage kind="loading" title="Loading blocked people…" />
      ) : null}

      {status === 'error' ? (
        <StateMessage
          kind="error"
          title={error}
          action={{
            label: 'Retry',
            accessibilityLabel: 'Retry loading blocked people',
            onPress: () => refresh(),
          }}
        />
      ) : null}

      {status === 'ready' && people.length === 0 ? (
        <View className="items-center gap-3 pt-16">
          <Ban size={32} color={ICON} />
          <Text className="px-4 text-center text-[15px] text-muted-foreground">
            You have not blocked anyone.
          </Text>
        </View>
      ) : null}

      {status === 'ready' && people.length > 0 ? (
        <View accessibilityRole="none" accessibilityLabel="Blocked people" className="gap-2">
          <Card>
            {people.map((person) => (
              <BlockedRow key={person.userId} person={person} onUnblock={unblock} />
            ))}
          </Card>
        </View>
      ) : null}

      {error !== '' && status === 'ready' ? (
        <Text accessibilityRole="alert" className="mt-3 text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
    </SettingsScreenShell>
  );
}

function BlockedRow({
  person,
  onUnblock,
}: {
  person: BlockedPerson;
  onUnblock: (userId: string) => Effect.Effect<void>;
}) {
  const [state, unblock] = useAction<void, void, never>(() => onUnblock(person.userId));
  return (
    <View className="flex-row items-center gap-3 px-3 py-2.5">
      <EntityAvatar
        person={{
          id: person.jid ?? person.userId,
          name: person.name,
          avatarUrl: person.image ?? undefined,
        }}
        size={44}
      />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
          {person.name}
          {person.handle !== null ? (
            <Text className="font-normal text-muted-foreground"> @{person.handle}</Text>
          ) : null}
        </Text>
      </View>
      <Button
        variant="outline"
        size="sm"
        accessibilityLabel={`Unblock ${person.name}`}
        disabled={isWaiting(state)}
        onPress={() => unblock()}
      >
        <Text>{isWaiting(state) ? 'Unblocking…' : 'Unblock'}</Text>
      </Button>
    </View>
  );
}
