import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { Link } from 'react-router';
import { lookupByHandle, type HandleProfile } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { type ApiFailure } from '@/lib/effect/errors';
import { useQuery } from '@/lib/effect/use-query';
import { ContactProfileRow } from './ContactProfileRow';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { TextInput } from './ui/text-input';

type Lookup =
  | { state: 'idle' }
  | { state: 'found'; profile: HandleProfile }
  | { state: 'missing' }
  | { state: 'error'; message: string };

const IDLE: Lookup = { state: 'idle' };

// Debounced exact lookup: the 300 ms sleep is the debounce, and useQuery
// interrupts it when the handle changes or the dialog closes. Unknown handles
// read as "missing".
const lookupHandle = (handle: string): Effect.Effect<Lookup> =>
  handle === ''
    ? Effect.succeed(IDLE)
    : Effect.sleep(300).pipe(
        Effect.andThen(fromApi(() => lookupByHandle(handle))),
        Effect.map((profile): Lookup => ({ state: 'found', profile })),
        Effect.catchTag('ApiFailure', (failure) => Effect.succeed(lookupFailure(failure))),
      );

function lookupFailure(failure: ApiFailure): Lookup {
  if (failure.status === 404) {
    return { state: 'missing' };
  }
  return {
    state: 'error',
    message:
      failure.code === 'rate_limited'
        ? 'Too many lookups — wait a little and try again.'
        : 'Could not look up that username. Try again.',
  };
}

/** "Add contact" dialog: type a `@username`, see the card, send a request. */
export function AddContactDialog({
  initialHandle,
  onClose,
}: {
  initialHandle?: string | undefined;
  onClose: () => void;
}) {
  const seed = initialHandle?.replace(/^@/, '') ?? '';
  const [query, setQuery] = useState(seed);

  const trimmed = query.trim().replace(/^@/, '');

  // Re-seed when the prefill changes (e.g. /@alice then /@bob reuses the
  // route): the query is derived from the prop until the user types.
  const [seedHandle, setSeedHandle] = useState(seed);
  if (seed !== seedHandle) {
    setSeedHandle(seed);
    setQuery(seed);
  }

  const [lookupResult] = useQuery(() => lookupHandle(trimmed), [trimmed]);
  // A relation change from the card (send, accept, ...) replaces the looked-up
  // profile for the handle it was made on.
  const [refreshed, setRefreshed] = useState<{ handle: string; profile: HandleProfile }>();
  const lookup: Lookup =
    refreshed !== undefined && refreshed.handle === trimmed
      ? { state: 'found', profile: refreshed.profile }
      : AsyncResult.isSuccess(lookupResult)
        ? lookupResult.value
        : IDLE;

  const refreshRelation = (profile: HandleProfile): void => {
    setRefreshed({ handle: trimmed, profile });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add contact"
      description="Type their @username to find them."
      size="sm"
      actions={
        <Button type="button" size="lg" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="mt-4">
        <TextInput
          id="add-contact-handle"
          label="Username"
          value={query}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={33}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="@ada"
        />
      </div>

      <div aria-live="polite" className="mt-4">
        {lookup.state === 'missing' && trimmed !== '' && (
          <p className="text-[14px] text-muted-foreground">
            No one with that username. Check the spelling.
          </p>
        )}
        {lookup.state === 'error' && (
          <p role="alert" className="text-[14px] text-danger">
            {lookup.message}
          </p>
        )}
        {lookup.state === 'found' && (
          <>
            <ContactProfileRow
              key={lookup.profile.userId}
              profile={lookup.profile}
              onRelationChange={refreshRelation}
            />
            {lookup.profile.relation === 'request_received' && (
              <div className="mt-2">
                <Link
                  to="/settings/requests"
                  className="inline-block rounded-full border border-border px-4 py-1.5 text-[14px] text-muted-foreground hover:bg-surface-raised"
                >
                  Go to Requests
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
