import { View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';

import { describeAuditEntry, formatRelativeAudit } from '@zilar/chat-core';
import type { PublicAuditEntry } from '@zilar/api-contract';

import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { useAuditActivity, type AuditApi, type AuditScope } from '@zilar/client-core';

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

export function AiActivityHeader({ ready, onRefresh }: { ready: boolean; onRefresh: () => void }) {
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
          <RefreshCw size={16} color={ICON} />
        </Button>
      ) : null}
    </View>
  );
}
/** Exactly one of `aiId` / `groupId` is set; `showHeader` lets the group page use the page's own title instead of the section heading. */
type AiActivityProps = { api: AuditApi; showHeader?: boolean } & (
  { aiId: string; groupId?: never } | { groupId: string; aiId?: never }
);

function scopeOf(aiId: string | undefined, groupId: string | undefined): AuditScope {
  return aiId !== undefined ? { aiId } : { groupId: groupId ?? '' };
}

export function AiActivity(props: AiActivityProps) {
  const { api, showHeader = true } = props;
  const { aiId, groupId } = props;
  const { status, entries, next, loadingMore, failure, refresh, loadMore } = useAuditActivity(
    api,
    scopeOf(aiId, groupId),
    { clearOnRefresh: true },
  );
  const message =
    failure === undefined
      ? ''
      : failure.kind === 'load'
        ? ACTIVITY_LOAD_FAILED_MESSAGE
        : ACTIVITY_MORE_FAILED_MESSAGE;

  return (
    <View accessibilityLabel="Activity" className="gap-1">
      {showHeader ? <AiActivityHeader ready={status === 'ready'} onRefresh={refresh} /> : null}
      <AiActivityContent
        state={{ status, entries, next, message, loadingMore }}
        onRetry={refresh}
        onLoadMore={loadMore}
      />
    </View>
  );
}
