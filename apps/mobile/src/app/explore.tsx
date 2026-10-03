import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, Compass, RefreshCw } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { Avatar } from '@/components/chat/avatar';
import {
  describeDirectoryError,
  describeJoinError,
  directorySubtitle,
  exploreActionTitle,
} from '@/components/directory/explore-helpers';
import { useDirectoryApi } from '@/components/directory/use-directory-api';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { well } from '@/lib/depth';
import type { DirectoryEntry, DirectoryKind } from '@/lib/directory-api';
import { postJoinTarget } from '@/components/directory/handle-helpers';
import { useChatStore } from '@/store/chat-store-provider';

type KindFilter = 'all' | DirectoryKind;

const KIND_OPTIONS: readonly { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'group', label: 'Groups' },
  { value: 'channel', label: 'Channels' },
];

/**
 * Explore (T-0183): the public directory. Searches public groups and
 * channels only (by handle or title prefix; empty lists the newest), filters
 * by kind, and pages by cursor. Each row shows the title, `@handle`,
 * description, member count and a Join button (or Open when already
 * joined). Guarded by `RequireAuth` (every route needs a session).
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
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { api } = useDirectoryApi();
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

  // Debounced search: under 2 characters (but not empty) waits for more
  // typing instead of erroring, like the web Explore page. The effect only
  // schedules the fetch; the timeout callback applies the loading state and
  // the promise callbacks the rows once (the lint rule flags synchronous
  // setState inside effects).
  useEffect(() => {
    if (trimmed !== '' && trimmed.length < 2) {
      return;
    }
    let active = true;
    const pending = setTimeout(() => {
      if (!active) {
        return;
      }
      setStatus('loading');
      setJoinError('');
      void api
        .searchDirectory({
          ...(trimmed === '' ? {} : { q: trimmed }),
          ...(kind === 'all' ? {} : { kind }),
        })
        .then((page) => {
          if (!active) {
            return;
          }
          setEntries(page.entries);
          setNext(page.next);
          setStatus('ready');
        })
        .catch((error: unknown) => {
          if (!active) {
            return;
          }
          setErrorMessage(
            describeDirectoryError(error, 'Could not load the directory. Try again.'),
          );
          setStatus('error');
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(pending);
    };
  }, [api, trimmed, kind, attempt]);

  const reload = useCallback(() => {
    setStatus('loading');
    setAttempt((value) => value + 1);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const listRef = useRef<FlatList<DirectoryEntry> | null>(null);
  void listRef;

  const loadMore = () => {
    if (next === null || loadingMore) {
      return;
    }
    setLoadingMore(true);
    setMoreError('');
    void api
      .searchDirectory({
        ...(trimmed === '' ? {} : { q: trimmed }),
        ...(kind === 'all' ? {} : { kind }),
        cursor: next,
      })
      .then((page) => {
        setEntries((current) => [...current, ...page.entries]);
        setNext(page.next);
      })
      .catch(() => setMoreError('Could not load more. Try again.'))
      .finally(() => setLoadingMore(false));
  };

  // After a join the store refreshes the list, but the refresh has not
  // landed when the join resolves — so the group screen opens from the id
  // the server answered (or the entry), never from a synchronous list read
  // that would fall through to the chats list on every success.
  const openEntry = (entry: DirectoryEntry) => {
    reloadChats();
    router.replace(postJoinTarget(entry.id));
  };

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
    void api
      .joinPublicGroup(entry.id)
      .then((result) => {
        setEntries((current) =>
          current.map((row) => (row.id === entry.id ? { ...row, joined: true } : row)),
        );
        reloadChats();
        router.replace(postJoinTarget(result.groupId));
      })
      .catch((error: unknown) => setJoinError(describeJoinError(error)))
      .finally(() => setJoiningId(undefined));
  };

  const emptyLine =
    trimmed === ''
      ? 'No public groups or channels yet. Be the first to make one public.'
      : `Nothing public matches "${trimmed}". Try another name or @handle.`;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 border-b border-divider bg-surface px-1 py-1">
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={ICON[scheme]} />
        </IconButton>
        <View className="ml-2.5 min-w-0 flex-1">
          <Text numberOfLines={1} className="shrink text-[15px] font-semibold text-foreground">
            Explore
          </Text>
          <Text numberOfLines={1} className="shrink text-[12px] text-muted-foreground">
            Public groups and channels anyone can join
          </Text>
        </View>
      </View>

      <View className="px-4 pt-3">
        <View className="h-10 flex-row items-center gap-2 rounded-xl px-3" style={well}>
          <Compass size={16} color="#8a8a8a" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            maxLength={100}
            placeholder="Search by name or @handle"
            placeholderTextColor={MUTED_FOREGROUND[scheme]}
            accessibilityLabel="Search public groups and channels"
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 text-[15px] text-foreground"
          />
        </View>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Kind filter"
          className="mt-2 flex-row gap-2"
        >
          {KIND_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: kind === option.value }}
              onPress={() => setKind(option.value)}
              className={`rounded-full border px-3 py-1 active:opacity-80 ${
                kind === option.value ? 'border-accent bg-accent/10' : 'border-border-strong'
              }`}
            >
              <Text
                className={`text-[14px] ${
                  kind === option.value ? 'font-medium text-foreground' : 'text-muted-foreground'
                }`}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {status === 'loading' && (
        <View className="items-center gap-3 pt-16">
          <ActivityIndicator color="#ededed" />
          <Text className="text-[15px] text-muted-foreground">Searching…</Text>
        </View>
      )}

      {status === 'error' && (
        <View className="items-center gap-3 px-6 pt-12">
          <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
            {errorMessage}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={reload}
            className="flex-row items-center gap-2 rounded-full border border-border-strong px-4 py-1.5 active:bg-surface-raised"
          >
            <RefreshCw size={16} color={ICON[scheme]} />
            <Text className="text-[14px] text-foreground">Retry</Text>
          </Pressable>
        </View>
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
              <Avatar id={item.id} name={item.title} size={40} />
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${exploreActionTitle(item)} ${item.title}`}
                disabled={joiningId !== undefined}
                onPress={() => join(item)}
                className="shrink-0 rounded-full bg-accent px-4 py-1.5 active:opacity-90 disabled:opacity-60"
              >
                <Text className="text-[14px] font-medium text-accent-foreground">
                  {joiningId === item.id ? 'Joining…' : exploreActionTitle(item)}
                </Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={
            <View className="items-center px-6 pt-12">
              <Text className="text-center text-[15px] text-muted-foreground">{emptyLine}</Text>
            </View>
          }
          ListFooterComponent={
            <View className="items-center gap-2 py-2">
              {next !== null && entries.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Show more"
                  disabled={loadingMore}
                  onPress={loadMore}
                  className="rounded-full border border-border-strong px-4 py-1.5 active:bg-surface-raised disabled:opacity-60"
                >
                  <Text className="text-[14px] text-foreground">
                    {loadingMore ? 'Loading…' : 'Show more'}
                  </Text>
                </Pressable>
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
