import { Effect } from 'effect';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ban, ChevronLeft } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import type { BlockedPerson } from '@/lib/contacts-api';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { blockedLoadFailure, performUnblock } from '@/components/contacts/blocks';
import { Avatar } from '@/components/chat/avatar';
import { isWaiting, useAction } from '@/lib/effect/use-action';

type PageStatus = 'loading' | 'ready' | 'error';

/**
 * Settings → Blocked people (T-0244, mirrors the web `BlockedPage`): who you
 * blocked, with an Unblock per row. Blocking is silent, so the subtitle says
 * so. Unblocking drops the row; a failure shows one fixed sentence and keeps
 * the row so the user can retry.
 */
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

  const [people, setPeople] = useState<BlockedPerson[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [error, setError] = useState('');

  // A new load replaces one still running (the focus refresh and Retry).
  const [, reload] = useAction<void, void, never>(
    () =>
      Effect.sync(() => {
        setStatus('loading');
        setError('');
      }).pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: () => api.listBlockedUsers(),
            catch: (loadError: unknown) => blockedLoadFailure(loadError),
          }),
        ),
        Effect.tap((blocked) =>
          Effect.sync(() => {
            setPeople(blocked);
            setStatus('ready');
          }),
        ),
        Effect.catch((message: string) =>
          Effect.sync(() => {
            setError(message);
            setStatus('error');
          }),
        ),
      ),
    { mode: 'replace' },
  );

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // One Unblock: the row drops on success, a failure keeps it and shows the
  // fixed sentence. The row's own action stops a double tap.
  const unblock = (userId: string): Effect.Effect<void> =>
    Effect.sync(() => setError('')).pipe(
      Effect.andThen(
        Effect.promise(() =>
          performUnblock(api, userId, () => {
            setPeople((rows) => rows.filter((row) => row.userId !== userId));
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
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 px-2 py-2">
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={ICON} />
        </IconButton>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[20px] font-semibold leading-6 text-foreground">
            Blocked people
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-[14px] leading-5 text-muted-foreground">
            They are not told.
          </Text>
        </View>
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View className="p-4">
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
                onPress: () => reload(),
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
        </View>
      </ScrollView>
      {mock ? (
        <View className="items-center border-t border-divider px-4 py-1">
          <Text className="text-[12px] text-muted-foreground">Mock data</Text>
        </View>
      ) : null}
    </SafeAreaView>
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
      <Avatar id={person.userId} name={person.name} size={44} />
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
