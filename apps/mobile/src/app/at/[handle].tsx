import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

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
import { Text } from '@/components/ui/text';
import type { DirectoryEntry } from '@/lib/directory-api';
import { useChatStore } from '@/store/chat-store-provider';

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

  useEffect(() => {
    if (handle === undefined || handle === '') {
      return;
    }
    // The effect only schedules the lookup; the timeout callback applies
    // the checking state and the promise the card once (the lint rule flags
    // synchronous setState inside effects).
    let active = true;
    const pending = setTimeout(() => {
      if (!active) {
        return;
      }
      setView({ state: 'checking' });
      void api
        .lookupGroupByHandle(handle)
        .then((entry) => {
          if (active) {
            setView({ state: 'ready', entry });
          }
        })
        .catch((error: unknown) => {
          if (active) {
            setView(handleRouteViewFor(error));
          }
        });
    }, 0);
    return () => {
      active = false;
      clearTimeout(pending);
    };
  }, [api, handle, retries]);

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
    void api
      .joinPublicGroup(entry.id)
      .then((result) => {
        reloadChats();
        router.replace(postJoinTarget(result.groupId));
      })
      .catch((error: unknown) => {
        setJoinError(describeJoinError(error));
        setBusy(false);
      });
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={close}
              className="mt-5 rounded-full bg-accent px-4 py-2 active:opacity-90"
            >
              <Text className="text-[15px] font-medium text-accent-foreground">Close</Text>
            </Pressable>
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry"
                onPress={retry}
                className="rounded-full bg-accent px-4 py-2 active:opacity-90"
              >
                <Text className="text-[15px] font-medium text-accent-foreground">Retry</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={close}
                className="rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised"
              >
                <Text className="text-[15px] text-foreground">Close</Text>
              </Pressable>
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={handleJoinLabel(view.entry)}
              disabled={busy}
              onPress={() => join(view.entry)}
              className="mt-5 w-full items-center rounded-full bg-accent px-4 py-2.5 active:opacity-90 disabled:opacity-60"
            >
              <Text className="text-[15px] font-medium text-accent-foreground">
                {busy ? 'Joining…' : handleJoinLabel(view.entry)}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={close}
              className="mt-3 rounded-full px-4 py-1.5 active:bg-surface-raised"
            >
              <Text className="text-[15px] text-muted-foreground">Close</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}
