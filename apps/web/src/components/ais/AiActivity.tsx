import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { describeAuditEntry, formatRelativeAudit } from '@zilar/chat-core';
import { auditApi, type AuditScope, type PublicAuditEntry } from '@/lib/api';
import { toApiFailure, useAuditActivity, useDelayed } from '@zilar/client-core';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { Button } from '@/components/ui/button';
import { failureText } from '@/components/sticker/pageActions';
import { FieldError } from './AiPageShell';

export { describeAuditEntry, formatRelativeAudit };

const RELATIVE_FORMATTER = new Intl.DateTimeFormat('en', {
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function ActivitySection({ scope }: { scope: AuditScope }) {
  const { status, entries, next, loadingMore, failure, refresh, loadMore } = useAuditActivity(
    auditApi,
    scope,
    { clearOnRefresh: false },
  );
  const message =
    failure === undefined
      ? ''
      : failureText(
          toApiFailure(failure.error),
          failure.kind === 'load' ? 'Could not load activity.' : 'Could not load more activity.',
        );

  return (
    <section aria-label="Activity" className="flex flex-col gap-2 border-t border-divider pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-medium">Activity</h3>
        {status === 'ready' && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh activity"
            onClick={refresh}
            className="rounded-full text-muted-foreground"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {status === 'loading' && <ActivitySkeleton />}

      {status === 'error' && entries.length === 0 && (
        <div className="flex flex-col gap-2">
          <FieldError>{message}</FieldError>
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

      {status === 'ready' && entries.length === 0 && (
        <p className="text-[13px] text-muted-foreground">No activity yet.</p>
      )}

      {entries.length > 0 && <ActivityList entries={entries} />}

      {status === 'ready' && next !== null && (
        <Button
          type="button"
          size="lg"
          className="self-start rounded-full px-5"
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      )}

      {entries.length > 0 && message !== '' && <FieldError>{message}</FieldError>}
    </section>
  );
}

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
