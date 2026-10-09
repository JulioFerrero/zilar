import { useState } from 'react';
import { Effect } from 'effect';
import { RefreshCw } from 'lucide-react';
import { listAudit, type AuditScope, type PublicAuditEntry } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useDelayed } from '@/lib/useDelayed';
import { Button } from '@/components/ui/button';
import { FieldError } from './AiPageShell';

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

// A failure without a server status did not come from api.ts: it shows the
// component's fixed sentence, never the thrown text (AGENTS.md).
function auditFailureText(failure: ApiFailure, fallback: string): string {
  return failure.status === 0 ? fallback : failure.message;
}

function serialiseScope(scope: AuditScope): string {
  return 'aiId' in scope ? `ai:${scope.aiId}` : `group:${scope.groupId}`;
}

// T-0086: shared between the AI panel and the group panel. The scope is one
// of `?aiId=…` or `?groupId=…` (the same union `listAudit` enforces); the
// shape, the loading / error / empty states and the load-more behaviour are
// identical between the two callers, so they share one component. Callers
// guard their own mounting: the AI panel mounts it for any AI the viewer
// owns; the group panel only mounts it for group owners and admins.
export function ActivitySection({ scope }: { scope: AuditScope }) {
  const [state, setState] = useState<LoadState>({
    status: 'loading',
    entries: [],
    next: null,
    message: '',
  });
  const scopeKey = serialiseScope(scope);
  // The first page is read once per scope key; Refresh and Retry call `reload`.
  // Callers pass a fresh `{ aiId }` / `{ groupId }` literal each render, so the
  // key, not the object, decides when to read again. A finished read replaces
  // the list; while a Refresh runs, the rows on screen stay.
  const [, reload] = useQuery(
    () =>
      fromApi(() => listAudit({ ...scope, limit: PAGE_LIMIT })).pipe(
        Effect.tap((page) =>
          Effect.sync(() =>
            setState({ status: 'ready', entries: page.entries, next: page.next, message: '' }),
          ),
        ),
        Effect.tapError((failure) =>
          Effect.sync(() =>
            setState({
              status: 'error',
              entries: [],
              next: null,
              message: auditFailureText(failure, 'Could not load activity.'),
            }),
          ),
        ),
      ),
    [scopeKey],
  );

  // One load-more at a time: a second click while a page loads is dropped.
  const [moreState, loadMore] = useAction<void, void, never>(() => {
    const next = state.next;
    if (next === null) {
      return Effect.void;
    }
    return fromApi(() => listAudit({ ...scope, limit: PAGE_LIMIT, before: next })).pipe(
      Effect.tap((more) =>
        Effect.sync(() =>
          setState((current) => {
            const seen = new Set(current.entries.map((entry) => entry.id));
            const merged = [...current.entries];
            for (const entry of more.entries) {
              if (!seen.has(entry.id)) {
                merged.push(entry);
                seen.add(entry.id);
              }
            }
            return { ...current, entries: merged, next: more.next, message: '' };
          }),
        ),
      ),
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() =>
          setState((current) => ({
            ...current,
            message: auditFailureText(failure, 'Could not load more activity.'),
          })),
        ),
      ),
    );
  });
  const loadingMore = isWaiting(moreState);

  return (
    <section aria-label="Activity" className="flex flex-col gap-2 border-t border-divider pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-medium">Activity</h3>
        {state.status === 'ready' && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh activity"
            onClick={reload}
            className="rounded-full text-muted-foreground"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {state.status === 'loading' && <ActivitySkeleton />}

      {state.status === 'error' && state.entries.length === 0 && (
        <div className="flex flex-col gap-2">
          <FieldError>{state.message}</FieldError>
          <Button type="button" size="lg" className="self-start rounded-full px-5" onClick={reload}>
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
          onClick={() => loadMore()}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      )}

      {state.entries.length > 0 && state.message !== '' && <FieldError>{state.message}</FieldError>}
    </section>
  );
}

// Thin wrapper kept for the AI panel: the rest of the app imports
// `AiActivity` and tests of the AI panel use it directly.
export function AiActivity({ aiId }: { aiId: string }) {
  return <ActivitySection scope={{ aiId }} />;
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
