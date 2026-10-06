import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';

import { useColorScheme } from 'nativewind';

import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import type { AuditApi, PublicAuditEntry } from '@/lib/audit-api';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON } from '@/lib/colors';
import { describeAuditEntry, formatRelativeAudit } from './activity-format';

/** Fixed user-facing line when the first activity page fails to load. */
export const ACTIVITY_LOAD_FAILED_MESSAGE = 'Could not load activity.';

/** Fixed user-facing line when a later page fails; the rows stay visible. */
export const ACTIVITY_MORE_FAILED_MESSAGE = 'Could not load more activity.';

export const ACTIVITY_EMPTY_MESSAGE = 'No activity yet.';

export type AiActivityState = {
  status: 'loading' | 'ready' | 'error';
  entries: PublicAuditEntry[];
  next: string | null;
  message: string;
  loadingMore: boolean;
};

/** Loads the first activity page for one AI. Any failure throws. */
export async function loadAiActivity(
  api: AuditApi,
  aiId: string,
): Promise<{ entries: PublicAuditEntry[]; next: string | null }> {
  const page = await api.listAiAudit(aiId);
  return { entries: page.entries, next: page.next };
}

/**
 * Appends the next activity page, de-duplicated by id (the server cursor is
 * inclusive on retries). Any failure throws; the caller keeps the rows.
 */
export async function appendAiActivity(
  api: AuditApi,
  aiId: string,
  before: string,
  current: PublicAuditEntry[],
): Promise<{ entries: PublicAuditEntry[]; next: string | null }> {
  const page = await api.listAiAudit(aiId, before);
  const seen = new Set(current.map((entry) => entry.id));
  const entries = [...current];
  for (const entry of page.entries) {
    if (!seen.has(entry.id)) {
      entries.push(entry);
      seen.add(entry.id);
    }
  }
  return { entries, next: page.next };
}

function ActivityRow({ entry, now }: { entry: PublicAuditEntry; now: Date }) {
  const at = new Date(entry.at);
  return (
    <View className="flex-row items-baseline justify-between gap-3 px-2 py-1">
      <Text className="min-w-0 flex-1 text-[13px]">{describeAuditEntry(entry)}</Text>
      <Text className="shrink-0 text-[12px] text-muted-foreground">
        {formatRelativeAudit(at, now)}
      </Text>
    </View>
  );
}

function ActivitySkeleton() {
  return (
    <View accessibilityLabel="Loading activity" className="gap-1.5 px-2">
      {[0, 1, 2].map((index) => (
        <View key={index} className="h-4 rounded-full bg-muted" />
      ))}
    </View>
  );
}

/**
 * The ready/loading/error body of the activity list, split out so tests can
 * render each state without mounting the loading effect.
 */
export function AiActivityContent({
  state,
  now = new Date(),
  onRetry,
  onLoadMore,
}: {
  state: AiActivityState;
  now?: Date;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  if (state.status === 'loading') {
    return <ActivitySkeleton />;
  }
  if (state.status === 'error') {
    return (
      <View className="gap-2 px-2">
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {state.message}
        </Text>
        <Button variant="outline" onPress={onRetry} className="self-start">
          <Text>Retry</Text>
        </Button>
      </View>
    );
  }
  if (state.entries.length === 0) {
    return <StateMessage kind="empty" size="inline" title={ACTIVITY_EMPTY_MESSAGE} />;
  }
  return (
    <View className="gap-0.5">
      {state.entries.map((entry) => (
        <ActivityRow key={entry.id} entry={entry} now={now} />
      ))}
      {state.next !== null ? (
        <Button
          variant="outline"
          disabled={state.loadingMore}
          onPress={onLoadMore}
          className="mt-1 self-start"
        >
          <Text>{state.loadingMore ? 'Loading…' : 'Load more'}</Text>
        </Button>
      ) : null}
      {state.message !== '' ? (
        <Text accessibilityRole="alert" className="px-2 text-[13px] text-danger">
          {state.message}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The section heading with the refresh button, shown once the list loaded.
 * Split out so tests can render it without mounting the loading effect.
 */
export function AiActivityHeader({ ready, onRefresh }: { ready: boolean; onRefresh: () => void }) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <View className="flex-row items-center justify-between">
      <Text className="px-2 text-[13px] font-semibold text-muted-foreground">Activity</Text>
      {ready ? (
        <Button
          variant="ghost"
          size="icon"
          className="mr-2 h-7 w-7 rounded-full"
          accessibilityLabel="Refresh activity"
          onPress={onRefresh}
        >
          <RefreshCw size={16} color={ICON[scheme]} />
        </Button>
      ) : null}
    </View>
  );
}
/**
 * The Activity section of the AI edit screen (T-0213, read only): what the AI
 * did, with web's descriptions and relative times, Refresh, and Load more.
 */
export function AiActivity({ api, aiId }: { api: AuditApi; aiId: string }) {
  const [state, setState] = useState<AiActivityState>({
    status: 'loading',
    entries: [],
    next: null,
    message: '',
    loadingMore: false,
  });
  const [reloadTick, setReloadTick] = useState(0);
  // Guarded synchronously so a double tap landing before React re-renders
  // the disabled button can never fire two page loads.
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const page = await loadAiActivity(api, aiId);
        if (!active) return;
        setState({
          status: 'ready',
          entries: page.entries,
          next: page.next,
          message: '',
          loadingMore: false,
        });
      } catch {
        if (!active) return;
        setState({
          status: 'error',
          entries: [],
          next: null,
          message: ACTIVITY_LOAD_FAILED_MESSAGE,
          loadingMore: false,
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [api, aiId, reloadTick]);

  const loadMore = (): void => {
    if (state.next === null || state.loadingMore || loadingMoreRef.current) {
      return;
    }
    const cursor = state.next;
    const base = state.entries;
    loadingMoreRef.current = true;
    setState((current) => ({ ...current, loadingMore: true }));
    void (async () => {
      try {
        const merged = await appendAiActivity(api, aiId, cursor, base);
        setState((current) => ({
          ...current,
          entries: merged.entries,
          next: merged.next,
          message: '',
          loadingMore: false,
        }));
      } catch {
        setState((current) => ({
          ...current,
          message: ACTIVITY_MORE_FAILED_MESSAGE,
          loadingMore: false,
        }));
      } finally {
        loadingMoreRef.current = false;
      }
    })();
  };

  const refresh = (): void => {
    setState({ status: 'loading', entries: [], next: null, message: '', loadingMore: false });
    setReloadTick((tick) => tick + 1);
  };

  return (
    <View accessibilityLabel="Activity" className="gap-1">
      <AiActivityHeader ready={state.status === 'ready'} onRefresh={refresh} />
      <AiActivityContent state={state} onRetry={refresh} onLoadMore={loadMore} />
    </View>
  );
}
