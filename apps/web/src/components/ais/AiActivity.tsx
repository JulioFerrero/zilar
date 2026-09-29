import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { listAudit, type PublicAuditEntry } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useDelayed } from '@/lib/useDelayed';
import { Button, FieldError } from './AiPageShell';

const PAGE_LIMIT = 20;

export function describeAuditEntry(entry: PublicAuditEntry): string {
  const decision = readDecision(entry.detail);
  switch (entry.action) {
    case 'approval.decided':
      if (decision === 'approve_once' || decision === 'approve_always') {
        return 'A request was approved';
      }
      if (decision === 'deny') {
        return 'A request was denied';
      }
      return 'A request was decided';
    case 'ai.stopped':
      return 'Stopped';
    case 'ai.resumed':
      return 'Resumed';
    default:
      return humaniseAction(entry.action);
  }
}

function readDecision(detail: PublicAuditEntry['detail']): string | null {
  if (detail === null) {
    return null;
  }
  const value = detail['decision'];
  return typeof value === 'string' ? value : null;
}

function humaniseAction(action: string): string {
  if (action === '') {
    return 'Activity';
  }
  const parts = action.split('.');
  const head = parts[0] ?? '';
  const tail = parts.slice(1);
  const capitalised = head === '' ? '' : head.charAt(0).toUpperCase() + head.slice(1);
  return [capitalised, ...tail].join(' ');
}

const RELATIVE_FORMATTER = new Intl.DateTimeFormat('en', {
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatRelativeAudit(at: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

type LoadStatus = 'loading' | 'ready' | 'error';

interface LoadState {
  status: LoadStatus;
  entries: PublicAuditEntry[];
  next: string | null;
  message: string;
}

export function AiActivity({ aiId }: { aiId: string }) {
  const [state, setState] = useState<LoadState>({
    status: 'loading',
    entries: [],
    next: null,
    message: '',
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const page = await listAudit({ aiId, limit: PAGE_LIMIT });
        if (!active) {
          return;
        }
        setState({
          status: 'ready',
          entries: page.entries,
          next: page.next,
          message: '',
        });
      } catch (error) {
        if (!active) {
          return;
        }
        setState({
          status: 'error',
          entries: [],
          next: null,
          message: error instanceof Error ? error.message : 'Could not load activity.',
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [aiId, refreshTick]);

  const loadMore = async (): Promise<void> => {
    if (state.next === null || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await listAudit({ aiId, limit: PAGE_LIMIT, before: state.next });
      setState((current) => {
        const seen = new Set(current.entries.map((entry) => entry.id));
        const merged = [...current.entries];
        for (const entry of page.entries) {
          if (!seen.has(entry.id)) {
            merged.push(entry);
            seen.add(entry.id);
          }
        }
        return { ...current, entries: merged, next: page.next };
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        message: error instanceof Error ? error.message : 'Could not load more activity.',
      }));
    } finally {
      setLoadingMore(false);
    }
  };

  const refresh = (): void => {
    setRefreshTick((tick) => tick + 1);
  };

  return (
    <section aria-label="Activity" className="flex flex-col gap-2 border-t border-divider pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-medium">Activity</h3>
        {state.status === 'ready' && (
          <button
            type="button"
            aria-label="Refresh activity"
            onClick={refresh}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {state.status === 'loading' && <ActivitySkeleton />}

      {state.status === 'error' && state.entries.length === 0 && (
        <div className="flex flex-col gap-2">
          <FieldError>{state.message}</FieldError>
          <Button
            type="button"
            size="lg"
            className="self-start rounded-full px-5"
            onClick={refresh}
          >
            Retry
          </Button>
        </div>
      )}

      {state.status === 'ready' && state.entries.length === 0 && (
        <p className="text-[13px] text-muted-foreground">No activity yet.</p>
      )}

      {state.entries.length > 0 && <ActivityList entries={state.entries} />}

      {state.status === 'ready' && state.next !== null && (
        <Button
          type="button"
          size="lg"
          className="self-start rounded-full px-5"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      )}

      {state.entries.length > 0 && state.message !== '' && <FieldError>{state.message}</FieldError>}
    </section>
  );
}

function ActivityList({ entries }: { entries: PublicAuditEntry[] }) {
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Activity entries">
      {entries.map((entry) => (
        <ActivityRow key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}

function ActivityRow({ entry }: { entry: PublicAuditEntry }) {
  const at = new Date(entry.at);
  const [now] = useState(() => new Date());
  return (
    <li className="flex items-baseline justify-between gap-3 text-[13px]">
      <span>{describeAuditEntry(entry)}</span>
      <time
        dateTime={at.toISOString()}
        title={RELATIVE_FORMATTER.format(at)}
        className={cn('shrink-0 text-muted-foreground')}
      >
        {formatRelativeAudit(at, now)}
      </time>
    </li>
  );
}

function ActivitySkeleton() {
  const visible = useDelayed(true, 200) === true;
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (!visible) {
    return null;
  }
  return (
    <div role="status" aria-label="Loading activity" className="flex flex-col gap-1.5">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cn(
            'h-4 rounded-full bg-surface-raised',
            !reduceMotion && 'animate-pulse',
            reduceMotion && 'skeleton-reduced',
          )}
        />
      ))}
    </div>
  );
}
