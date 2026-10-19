import { Effect } from 'effect';
import { useFocusEffect, useRouter } from 'expo-router';
import { Compass } from 'lucide-react-native';

import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import {
  describeDirectoryError,
  describeJoinError,
  directorySubtitle,
  exploreActionTitle,
} from '@/components/directory/explore-helpers';
import { makeDirectoryApi } from '@/lib/directory-api';
import { useApi } from '@/lib/use-mockable-api';
import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SearchField } from '@/components/ui/search-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import type { DirectoryEntry, DirectoryKind, SearchDirectoryInput } from '@/lib/directory-api';
import { useAction } from '@/lib/effect/use-action';
import { postJoinTarget } from '@/components/directory/handle-helpers';
import { useChatStore } from '@/store/chat-store-provider';

type KindFilter = 'all' | DirectoryKind;

/** Lifts a *-api.ts call into an Effect that fails with the thrown error itself: the describe helpers read its class, status and code. */
function fromThrown<A>(call: () => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: call, catch: (cause) => cause });
}

const KIND_OPTIONS: readonly { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'group', label: 'Groups' },
  { value: 'channel', label: 'Channels' },
];

/**
 * The public directory: searches public groups and channels by handle or title prefix (empty lists the newest); every route needs a session.
 */
export default function ExploreScreen() {
  return (
    <RequireAuth>
      <ExploreList />
    </RequireAuth>
  );
}

function ExploreList() {
  const router = useRouter();
  const { api } = useApi(makeDirectoryApi);
  const reloadChats = useChatStore((state) => state.reloadChats);

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [joiningId, setJoiningId] = useState<string | undefined>(undefined);
  const [joinError, setJoinError] = useState('');

  const trimmed = query.trim();

  // Under 2 characters (but not empty) waits for more typing, like web. The loading state waits one tick (the lint rule flags synchronous setState); a newer search, an input change or an unmount interrupts it, so a stale page never replaces the rows.
  const [, search, searchControls] = useAction(
    (input: SearchDirectoryInput) =>
      Effect.sleep(300).pipe(
        Effect.andThen(
          Effect.sync(() => {
            setStatus((current) => (current === 'ready' ? current : 'loading'));
            setJoinError('');
          }),
        ),
        Effect.andThen(fromThrown(() => api.searchDirectory(input))),
        Effect.tap((page) =>
          Effect.sync(() => {
            setEntries(page.entries);
            setNext(page.next);
            setStatus('ready');
          }),
        ),
        Effect.tapError((error) =>
          Effect.sync(() => {
            setErrorMessage(
              describeDirectoryError(error, 'Could not load the directory. Try again.'),
            );
            setStatus((current) => (current === 'ready' ? current : 'error'));
          }),
        ),
      ),
    { mode: 'replace' },
  );

  useEffect(() => {
    if (trimmed !== '' && trimmed.length < 2) {
      return;
    }
    search({
      ...(trimmed === '' ? {} : { q: trimmed }),
      ...(kind === 'all' ? {} : { kind }),
    });
    return searchControls.interrupt;
  }, [api, trimmed, kind, attempt, search, searchControls]);

  const reload = useCallback(() => {
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    setAttempt((value) => value + 1);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const [, fetchMore] = useAction((input: SearchDirectoryInput) =>
    fromThrown(() => api.searchDirectory(input)).pipe(
      Effect.tap((page) =>
        Effect.sync(() => {
          setEntries((current) => [...current, ...page.entries]);
          setNext(page.next);
        }),
      ),
      Effect.tapError(() => Effect.sync(() => setMoreError('Could not load more. Try again.'))),
      Effect.ensuring(Effect.sync(() => setLoadingMore(false))),
    ),
  );

  const loadMore = () => {
    if (next === null || loadingMore) {
      return;
    }
    setLoadingMore(true);
    setMoreError('');
    fetchMore({
      ...(trimmed === '' ? {} : { q: trimmed }),
      ...(kind === 'all' ? {} : { kind }),
      cursor: next,
    });
  };

  // The store refresh has not landed when the join resolves, so the group screen opens from the id the server answered, never from a synchronous list read.
  const openEntry = (entry: DirectoryEntry) => {
    reloadChats();
    router.replace(postJoinTarget(entry.id));
  };

  const [, joinPublic] = useAction((entry: DirectoryEntry) =>
    fromThrown(() => api.joinPublicGroup(entry.id)).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          setEntries((current) =>
            current.map((row) => (row.id === entry.id ? { ...row, joined: true } : row)),
          );
          reloadChats();
          router.replace(postJoinTarget(result.groupId));
        }),
      ),
      Effect.tapError((error) => Effect.sync(() => setJoinError(describeJoinError(error)))),
      Effect.ensuring(Effect.sync(() => setJoiningId(undefined))),
    ),
  );

  const join = (entry: DirectoryEntry) => {
    if (joiningId !== undefined) {
      return;
    }
    if (entry.joined) {
      openEntry(entry);
      return;
    }
    setJoiningId(entry.id);
    setJoinError('');
    joinPublic(entry);
  };

  const emptyLine =
    trimmed === ''
      ? 'No public groups or channels yet. Be the first to make one public.'
      : `Nothing public matches "${trimmed}". Try another name or @handle.`;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader
        variant="sub"
        title="Explore"
        subtitle="Public groups and channels anyone can join"
        onBack={() => router.back()}
      />

      <View className="px-4 pt-3">
        <SearchField
          icon={Compass}
          value={query}
          onChangeText={setQuery}
          maxLength={100}
          placeholder="Search by name or @handle"
          accessibilityLabel="Search public groups and channels"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <SegmentedControl
          mode="radio"
          accessibilityLabel="Kind filter"
          className="mt-2"
          options={[...KIND_OPTIONS]}
          value={kind}
          onChange={(value) => setKind(value as KindFilter)}
        />
      </View>

      {status === 'loading' && <StateMessage kind="loading" title="Searching…" />}

      {status === 'error' && (
        <StateMessage
          kind="error"
          title={errorMessage}
          action={{ label: 'Retry', onPress: reload }}
        />
      )}

      {status === 'ready' && (
        <FlatList
          className="mt-2 flex-1"
          data={entries}
          keyExtractor={(entry) => entry.id}
          contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <View className="flex-row items-center gap-3 rounded-xl px-1 py-2">
              <EntityAvatar chat={item} size={40} />
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
                  {item.title}{' '}
                  <Text className="font-normal text-muted-foreground">@{item.handle}</Text>
                </Text>
                {item.description !== null && item.description !== '' && (
                  <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
                    {item.description}
                  </Text>
                )}
                <Text className="text-[13px] text-muted-foreground">{directorySubtitle(item)}</Text>
              </View>
              <Button
                variant="default"
                size="sm"
                className="shrink-0"
                accessibilityLabel={`${exploreActionTitle(item)} ${item.title}`}
                disabled={joiningId !== undefined}
                onPress={() => join(item)}
              >
                <Text>{joiningId === item.id ? 'Joining…' : exploreActionTitle(item)}</Text>
              </Button>
            </View>
          )}
          ListEmptyComponent={<StateMessage kind="empty" title={emptyLine} />}
          ListFooterComponent={
            <View className="items-center gap-2 py-2">
              {next !== null && entries.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  accessibilityLabel="Show more"
                  disabled={loadingMore}
                  onPress={loadMore}
                >
                  <Text>{loadingMore ? 'Loading…' : 'Show more'}</Text>
                </Button>
              )}
              {moreError !== '' && (
                <Text accessibilityRole="alert" className="text-center text-[14px] text-danger">
                  {moreError}
                </Text>
              )}
              {joinError !== '' && (
                <Text accessibilityRole="alert" className="text-center text-[14px] text-danger">
                  {joinError}
                </Text>
              )}
            </View>
          }
        />
      )}
      {status === 'ready' && joinError !== '' && entries.length === 0 ? (
        <View className="items-center px-6 pb-4">
          <Text accessibilityRole="alert" className="text-center text-[14px] text-danger">
            {joinError}
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
