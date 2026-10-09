import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import {
  acceptContactRequest,
  cancelContactRequest,
  declineContactRequest,
  listContactRequests,
  type ContactRequestView,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';

type ContactAction = 'accept' | 'decline' | 'cancel';

/** Settings → Requests: incoming (Accept/Decline) and outgoing (Cancel). */
export function RequestsPage({ onBack }: { onBack: () => void }) {
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [list] = useQuery(() => fromApi(() => listContactRequests()), []);

  const loaded = AsyncResult.isNotInitial(list);
  const incoming = AsyncResult.isSuccess(list)
    ? list.value.incoming.filter((request) => !removedIds.has(request.id))
    : [];
  const outgoing = AsyncResult.isSuccess(list)
    ? list.value.outgoing.filter((request) => !removedIds.has(request.id))
    : [];
  const loadFailure = shownFailure(list);
  const error = loadFailure !== undefined ? friendlyError(loadFailure) : actionError;

  const markRemoved = (id: string): void => {
    setRemovedIds((ids) => new Set(ids).add(id));
  };

  return (
    <SettingsShell title="Requests" subtitle="People who want to add you." onBack={onBack}>
      <div className={SETTINGS_COLUMN}>
        {!loaded && <StateMessage kind="loading" title="Loading requests…" />}
        {loaded && incoming.length === 0 && outgoing.length === 0 && (
          <StateMessage kind="empty" title="No pending requests." />
        )}
        {incoming.length > 0 && (
          <section aria-label="Incoming requests" className="flex flex-col gap-2">
            <SectionLabel>Incoming</SectionLabel>
            <Card>
              <ul className="divide-y divide-divider">
                {incoming.map((request) => (
                  <ContactRow
                    key={request.id}
                    request={request}
                    incoming
                    onDone={markRemoved}
                    onError={setActionError}
                  />
                ))}
              </ul>
            </Card>
          </section>
        )}
        {outgoing.length > 0 && (
          <section aria-label="Outgoing requests" className="flex flex-col gap-2">
            <SectionLabel>Sent</SectionLabel>
            <Card>
              <ul className="divide-y divide-divider">
                {outgoing.map((request) => (
                  <ContactRow
                    key={request.id}
                    request={request}
                    incoming={false}
                    onDone={markRemoved}
                    onError={setActionError}
                  />
                ))}
              </ul>
            </Card>
          </section>
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
 * One request row with its own action, so two rows can be answered at once;
 * a second click on the same row waits for the first. The row unmounts when
 * its request is removed, which is safe: nothing runs after the removal.
 */
function ContactRow({
  request,
  incoming,
  onDone,
  onError,
}: {
  request: ContactRequestView;
  incoming: boolean;
  onDone: (id: string) => void;
  onError: (message: string | undefined) => void;
}) {
  const [state, act] = useAction((action: ContactAction) =>
    fromApi(() => contactCall(action, request.id)).pipe(
      Effect.tap(() => Effect.sync(() => onDone(request.id))),
      Effect.tapError((failure) => Effect.sync(() => onError(friendlyError(failure)))),
    ),
  );
  const busy = isWaiting(state);
  const startAct = (action: ContactAction): void => {
    if (busy) {
      return;
    }
    onError(undefined);
    act(action);
  };

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1 basis-40 text-[14px]">
        <span className="block truncate text-[15px] font-medium">
          {request.other.name}{' '}
          {request.other.handle !== null && (
            <span className="font-normal text-muted-foreground">@{request.other.handle}</span>
          )}
        </span>
        {!incoming && (
          <span className="text-[13px] text-muted-foreground">Waiting for an answer</span>
        )}
      </span>
      {incoming ? (
        <span className="flex gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => startAct('accept')}>
            Accept
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => startAct('decline')}
          >
            Decline
          </Button>
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => startAct('cancel')}
        >
          Cancel
        </Button>
      )}
    </li>
  );
}

function contactCall(action: ContactAction, id: string): Promise<unknown> {
  if (action === 'accept') {
    return acceptContactRequest(id);
  }
  if (action === 'decline') {
    return declineContactRequest(id);
  }
  return cancelContactRequest(id);
}

/** The last failure, hidden while a new call runs (the page cleared it at once before). */
function shownFailure<A>(state: AsyncResult.AsyncResult<A, ApiFailure>): ApiFailure | undefined {
  return isWaiting(state) ? undefined : failureOf(state);
}

function friendlyError(error: ApiFailure): string {
  if (error.code === 'rate_limited') {
    return 'Too many tries — wait a little and try again.';
  }
  if (error.code === 'unknown_error') {
    return 'Something went wrong. Try again.';
  }
  return error.message;
}
