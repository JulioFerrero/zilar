import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, lookupByHandle, type HandleProfile } from '@/lib/api';
import { ContactProfileRow } from './ContactProfileRow';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

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
  const [lookup, setLookup] = useState<
    | { state: 'idle' }
    | { state: 'found'; profile: HandleProfile }
    | { state: 'missing' }
    | { state: 'error'; message: string }
  >({ state: 'idle' });

  const trimmed = query.trim().replace(/^@/, '');

  // Re-seed when the prefill changes (e.g. /@alice then /@bob reuses the
  // route): the query is derived from the prop until the user types.
  const [seedHandle, setSeedHandle] = useState(seed);
  if (seed !== seedHandle) {
    setSeedHandle(seed);
    setQuery(seed);
    setLookup({ state: 'idle' });
  }

  // Debounced exact lookup; unknown handles read as "missing". The effect
  // only schedules the lookup (the lint rule flags synchronous setState
  // inside effects); the timeout callback applies the result once.
  useEffect(() => {
    if (trimmed === '') {
      return;
    }
    let active = true;
    const pending = setTimeout(() => {
      void lookupByHandle(trimmed).then(
        (profile) => {
          if (active) {
            setLookup({ state: 'found', profile });
          }
        },
        (error: unknown) => {
          if (!active) {
            return;
          }
          if (error instanceof ApiError && error.status === 404) {
            setLookup({ state: 'missing' });
            return;
          }
          setLookup({
            state: 'error',
            message:
              error instanceof ApiError && error.code === 'rate_limited'
                ? 'Too many lookups — wait a little and try again.'
                : 'Could not look up that username. Try again.',
          });
        },
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(pending);
    };
  }, [trimmed]);

  const refreshRelation = (profile: HandleProfile): void => {
    setLookup({ state: 'found', profile });
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
      <label className="mt-4 block text-[14px] font-medium" htmlFor="add-contact-handle">
        Username
      </label>
      <input
        id="add-contact-handle"
        value={query}
        autoFocus
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={33}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="@ada"
        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
      />

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
