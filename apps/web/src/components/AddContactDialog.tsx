import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, lookupByHandle, sendContactRequest, type HandleProfile } from '@/lib/api';

/** "Add contact" dialog: type a `@username`, see the card, send a request. */
export function AddContactDialog({
  initialHandle,
  onClose,
}: {
  initialHandle?: string | undefined;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialHandle?.replace(/^@/, '') ?? '');
  const [lookup, setLookup] = useState<
    | { state: 'idle' }
    | { state: 'found'; profile: HandleProfile }
    | { state: 'missing' }
    | { state: 'error'; message: string }
  >({ state: 'idle' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>(undefined);

  const trimmed = query.trim().replace(/^@/, '');

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
            setSent(false);
            setSendError(undefined);
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

  // Esc closes the dialog from any focus position, same as Close.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const send = async (): Promise<void> => {
    if (lookup.state !== 'found' || sending) {
      return;
    }
    setSending(true);
    setSendError(undefined);
    try {
      await sendContactRequest(lookup.profile.handle);
      setSent(true);
    } catch (error) {
      setSendError(friendlySendError(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add contact"
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-xl"
      >
        <h2 className="text-[18px] font-semibold">Add contact</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">Type their @username to find them.</p>
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
            <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
              <p className="text-[15px] font-medium">
                {lookup.profile.name}{' '}
                <span className="font-normal text-muted-foreground">@{lookup.profile.handle}</span>
              </p>
              {lookup.profile.relation === 'self' && (
                <p className="mt-1 text-[14px] text-muted-foreground">That&apos;s you.</p>
              )}
              {lookup.profile.relation === 'contact' && (
                <p className="mt-1 text-[14px] text-muted-foreground">
                  You&apos;re already contacts.
                </p>
              )}
              {lookup.profile.relation === 'request_sent' && (
                <p className="mt-1 text-[14px] text-muted-foreground">
                  Request already sent — they haven&apos;t answered yet.
                </p>
              )}
              {lookup.profile.relation === 'request_received' && (
                <div className="mt-2">
                  <p className="text-[14px] text-muted-foreground">
                    They already asked to add you.
                  </p>
                  <Link
                    to="/settings/requests"
                    className="mt-2 inline-block rounded-full bg-accent px-4 py-1.5 text-[14px] font-medium text-accent-foreground hover:bg-accent/90"
                  >
                    Go to Requests to accept
                  </Link>
                </div>
              )}
              {lookup.profile.relation === 'none' &&
                (sent ? (
                  <p className="mt-1 text-[14px] text-muted-foreground">Request sent.</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={sending}
                    className="mt-2 rounded-full bg-accent px-4 py-1.5 text-[14px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
                  >
                    {sending ? 'Sending…' : 'Send request'}
                  </button>
                ))}
              {sendError !== undefined && (
                <p role="alert" className="mt-2 text-[14px] text-danger">
                  {sendError}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function friendlySendError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'already_contact':
        return "You're already contacts.";
      case 'request_exists':
        return 'A request is already pending.';
      case 'too_many_requests':
        return 'Too many pending requests — wait for some answers first.';
      case 'declined_recently':
        return 'They declined recently — try again in a few days.';
      case 'rate_limited':
        return 'Too many tries — wait a little and try again.';
      default:
        return error.message;
    }
  }
  return 'Could not send the request. Try again.';
}
