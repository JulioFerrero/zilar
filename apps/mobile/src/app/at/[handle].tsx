import { Effect } from 'effect';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { LoadingScreen } from '@/auth/RequireAuth';
import { useSession } from '@/auth/session';
import { Avatar } from '@/components/chat/avatar';
import { describeJoinError, directorySubtitle } from '@/components/directory/explore-helpers';
import {
  handleJoinLabel,
  handleRouteViewFor,
  postJoinTarget,
  type HandleView,
} from '@/components/directory/handle-helpers';
import { useDirectoryApi } from '@/components/directory/use-directory-api';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { DirectoryEntry } from '@/lib/directory-api';
import { useAction } from '@/lib/effect/use-action';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * Lifts a *-api.ts call into an Effect that fails with the thrown error
 * itself: the describe helpers read its class, status and code.
 */
function attempt<A>(call: () => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: call, catch: (cause) => cause });
}

/**
 * The `@handle` share entry (T-0183): `zilar://at/<handle>` (custom scheme,
 * registered in `app.json`) opens this route with the handle as the
 * `handle` param. A public group shows a card with title, description,
 * member count and Join (or Open when already joined); an unknown handle
 * and a private group answer the same 404, so both read the same neutral
 * not-found line. Any other lookup failure shows an error state with Retry.
 */
export default function GroupHandleRoute() {
  const { status } = useSession();
  const params = useLocalSearchParams<{ handle?: string }>();
  const raw = typeof params.handle === 'string' ? params.handle : undefined;

  if (status === 'loading') {
    return <LoadingScreen />;
  }
  if (status === 'guest') {
    const from = raw === undefined ? '/explore' : `/at/${raw}`;
    return <Redirect href={`/login?from=${encodeURIComponent(from)}`} />;
  }
  return <HandleCard handle={raw} />;
}

function HandleCard({ handle }: { handle: string | undefined }) {
  const router = useRouter();
  const { api } = useDirectoryApi();
  const reloadChats = useChatStore((state) => state.reloadChats);
  const [view, setView] = useState<HandleView>(
    handle === undefined || handle === '' ? { state: 'not-found' } : { state: 'checking' },
  );
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [retries, setRetries] = useState(0);

  // The lookup waits one tick before it applies the checking state (the lint
  // rule flags synchronous setState inside effects), and a newer lookup or an
  // unmount interrupts it, so a stale answer never replaces the card.
  const [, lookup, lookupControls] = useAction(
    (value: string) =>
      Effect.sleep(0).pipe(
        Effect.andThen(Effect.sync(() => setView({ state: 'checking' }))),
        Effect.andThen(attempt(() => api.lookupGroupByHandle(value))),
        Effect.tap((entry) => Effect.sync(() => setView({ state: 'ready', entry }))),
        Effect.tapError((error) => Effect.sync(() => setView(handleRouteViewFor(error)))),
      ),
    { mode: 'replace' },
  );

  useEffect(() => {
    if (handle === undefined || handle === '') {
      return;
    }
    lookup(handle);
    return lookupControls.interrupt;
  }, [api, handle, retries, lookup, lookupControls]);

  const close = () => {
    router.replace('/');
  };

  const retry = () => {
    setRetries((count) => count + 1);
  };

  // After a join the store refreshes the list, but the refresh has not
  // landed when the join resolves — so the group screen opens from the id
  // the server answered (or the entry), never from a synchronous list read
  // that would fall through to the chats list on every success.
  const [, joinPublic] = useAction((entry: DirectoryEntry) =>
    attempt(() => api.joinPublicGroup(entry.id)).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          reloadChats();
          router.replace(postJoinTarget(result.groupId));
        }),
      ),
      Effect.tapError((error) =>
        Effect.sync(() => {
          setJoinError(describeJoinError(error));
          setBusy(false);
        }),
      ),
    ),
  );

  const join = (entry: DirectoryEntry) => {
    if (busy) {
      return;
    }
    if (entry.joined) {
      reloadChats();
      router.replace(postJoinTarget(entry.id));
      return;
    }
    setBusy(true);
    setJoinError('');
    joinPublic(entry);
  };

  return (
    <View className="flex-1 items-center justify-center bg-background p-4">
      <View className="w-full max-w-sm items-center rounded-2xl border border-border-strong bg-surface p-6">
        {view.state === 'checking' && (
          <>
            <ActivityIndicator color="#ededed" />
            <Text className="mt-3 text-[15px] text-muted-foreground">Opening…</Text>
          </>
        )}
        {view.state === 'not-found' && (
          <>
            <Text className="text-center text-[20px] font-semibold text-foreground">
              Couldn&apos;t open this link
            </Text>
            <Text className="mt-2 text-center text-[15px] text-muted-foreground">
              This link is for a group that doesn&apos;t exist or isn&apos;t public.
            </Text>
            <Button
              accessibilityLabel="Close"
              onPress={close}
              variant="default"
              size="default"
              className="mt-5"
            >
              <Text>Close</Text>
            </Button>
          </>
        )}
        {view.state === 'error' && (
          <>
            <Text className="text-center text-[20px] font-semibold text-foreground">
              Couldn&apos;t open this link
            </Text>
            <Text
              accessibilityRole="alert"
              className="mt-2 text-center text-[15px] text-muted-foreground"
            >
              {view.message}
            </Text>
            <View className="mt-5 flex-row gap-2">
              <Button accessibilityLabel="Retry" onPress={retry} variant="default" size="default">
                <Text>Retry</Text>
              </Button>
              <Button accessibilityLabel="Close" onPress={close} variant="outline" size="default">
                <Text>Close</Text>
              </Button>
            </View>
          </>
        )}
        {view.state === 'ready' && (
          <>
            <Avatar id={view.entry.id} name={view.entry.title} size={56} />
            <Text className="mt-3 text-center text-[20px] font-semibold text-foreground">
              {view.entry.title}
            </Text>
            <Text className="mt-1 text-center text-[14px] text-muted-foreground">
              @{view.entry.handle}
            </Text>
            {view.entry.description !== null && view.entry.description !== '' && (
              <Text className="mt-2 text-center text-[15px] text-muted-foreground">
                {view.entry.description}
              </Text>
            )}
            <Text className="mt-2 text-center text-[14px] text-muted-foreground">
              {directorySubtitle(view.entry)}
            </Text>
            {joinError !== '' && (
              <Text accessibilityRole="alert" className="mt-3 text-center text-[14px] text-danger">
                {joinError}
              </Text>
            )}
            <Button
              accessibilityLabel={handleJoinLabel(view.entry)}
              disabled={busy}
              onPress={() => join(view.entry)}
              variant="default"
              size="lg"
              className="mt-5 w-full"
            >
              <Text>{busy ? 'Joining…' : handleJoinLabel(view.entry)}</Text>
            </Button>
            <Button
              accessibilityLabel="Close"
              onPress={close}
              variant="ghost"
              size="default"
              className="mt-3"
            >
              <Text>Close</Text>
            </Button>
          </>
        )}
      </View>
    </View>
  );
}
