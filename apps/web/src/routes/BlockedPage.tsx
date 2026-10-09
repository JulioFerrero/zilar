import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { listBlockedUsers, unblockUser, type BlockedPerson } from '@/lib/api';
import { refreshBlockedJids } from '@/lib/blockedJids';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';

/** Settings → Blocked people: who you blocked, with an Unblock per row. */
export function BlockedPage({ onBack }: { onBack: () => void }) {
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [unblockError, setUnblockError] = useState<string | undefined>(undefined);
  const [blocked] = useQuery(() => fromApi(() => listBlockedUsers()), []);

  const loaded = AsyncResult.isNotInitial(blocked);
  const people = AsyncResult.isSuccess(blocked) ? blocked.value : [];
  const visibleCount = people.filter((person) => !removedIds.has(person.userId)).length;
  const loadFailure = shownFailure(blocked);
  const error = loadFailure !== undefined ? friendlyError(loadFailure) : unblockError;

  const markRemoved = (userId: string): void => {
    setRemovedIds((ids) => new Set(ids).add(userId));
  };

  return (
    <SettingsShell
      title="Blocked people"
      subtitle="They are not told. Their contact requests don't reach you."
      onBack={onBack}
    >
      <div className={SETTINGS_COLUMN}>
        {!loaded && <StateMessage kind="loading" title="Loading blocked people…" />}
        {loaded && visibleCount === 0 && error === undefined && (
          <StateMessage kind="empty" title="You haven't blocked anyone." />
        )}
        {visibleCount > 0 && (
          <Card>
            <ul className="divide-y divide-divider">
              {people.map((person) => (
                <BlockedRow
                  key={person.userId}
                  person={person}
                  removed={removedIds.has(person.userId)}
                  onUnblocked={markRemoved}
                  onError={setUnblockError}
                />
              ))}
            </ul>
          </Card>
        )}
        {error !== undefined && (
          <p role="alert" className="text-[14px] text-danger">
            {error}
          </p>
        )}
      </div>
    </SettingsShell>
  );
}

/**
 * One blocked person with its own Unblock action, so two rows can be
 * unblocked at once; a second click on the same row waits for the first.
 * A removed row returns nothing but stays mounted: the refresh after the
 * unblock still runs to the end, and an unmount would cancel it.
 */
function BlockedRow({
  person,
  removed,
  onUnblocked,
  onError,
}: {
  person: BlockedPerson;
  removed: boolean;
  onUnblocked: (userId: string) => void;
  onError: (message: string | undefined) => void;
}) {
  const [state, unblock] = useAction((userId: string) =>
    fromApi(() => unblockUser(userId)).pipe(
      Effect.tap(() => Effect.sync(() => onUnblocked(userId))),
      Effect.andThen(fromApi(() => refreshBlockedJids())),
      Effect.tapError((failure) => Effect.sync(() => onError(friendlyUnblockError(failure)))),
    ),
  );
  if (removed) {
    return null;
  }
  const busy = isWaiting(state);
  const startUnblock = (): void => {
    if (busy) {
      return;
    }
    onError(undefined);
    unblock(person.userId);
  };

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <Avatar
        id={person.userId}
        name={person.name}
        size={36}
        avatarUrl={person.image ?? undefined}
      />
      <span className="min-w-0 flex-1 basis-40 text-[14px]">
        <span className="block truncate text-[15px] font-medium">
          {person.name}
          {person.handle !== null && (
            <span className="font-normal text-muted-foreground"> @{person.handle}</span>
          )}
        </span>
      </span>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={startUnblock}>
        {busy ? 'Unblocking…' : 'Unblock'}
      </Button>
    </li>
  );
}

/** The last failure, hidden while a new call runs (the page cleared it at once before). */
function shownFailure<A>(state: AsyncResult.AsyncResult<A, ApiFailure>): ApiFailure | undefined {
  return isWaiting(state) ? undefined : failureOf(state);
}

function friendlyError(error: ApiFailure): string {
  if (error.code === 'rate_limited') {
    return 'Too many tries — wait a little and try again.';
  }
  return 'Could not load blocked people. Try again.';
}

function friendlyUnblockError(error: ApiFailure): string {
  if (error.code === 'rate_limited') {
    return 'Too many tries — wait a little and try again.';
  }
  return 'Could not unblock. Try again.';
}
