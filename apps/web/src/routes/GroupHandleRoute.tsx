import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ApiError, lookupGroupByHandle, type DirectoryEntry } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { type ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { AddContactDialog } from '@/components/AddContactDialog';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

type Lookup =
  { readonly state: 'group'; readonly entry: DirectoryEntry } | { readonly state: 'person' };

type LookupState = AsyncResult.AsyncResult<Lookup, ApiFailure>;

type LookupView =
  Lookup | { readonly state: 'checking' } | { readonly state: 'error'; readonly message: string };

/** A Promise call from the store. Its own error reaches the caller unchanged. */
function attempt<A>(run: () => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: run, catch: (error: unknown) => error });
}

/**
 * One lookup of the handle. The zero-delay sleep is the old `setTimeout(0)`:
 * the lookup starts on the next turn, and a change of the handle or the
 * session interrupts it.
 */
function lookupHandle(handle: string): Effect.Effect<Lookup, ApiFailure> {
  return Effect.sleep(0).pipe(
    Effect.andThen(fromApi(() => lookupGroupByHandle(handle))),
    Effect.map((entry): Lookup => ({ state: 'group', entry })),
    // A 404 (unknown, private, or a person) falls back to the Add contact dialog.
    Effect.catchIf(
      (failure: ApiFailure) => failure.status === 404,
      () => Effect.succeed<Lookup>({ state: 'person' }),
    ),
  );
}

/** The lookup in words: a running lookup (and a retry) shows the Add contact dialog. */
function lookupView(result: LookupState): LookupView {
  if (isWaiting(result)) {
    return { state: 'checking' };
  }
  if (AsyncResult.isSuccess(result)) {
    return result.value;
  }
  const failure = failureOf(result);
  if (failure !== undefined) {
    return {
      state: 'error',
      message:
        failure.code === 'rate_limited'
          ? 'Too many lookups — wait a little and try again.'
          : 'Could not open that link. Try again.',
    };
  }
  return { state: 'checking' };
}

/**
 * The `/@handle` share entry (T-0164): resolves a person or a public group.
 * A public group opens a card with title, description, member count and
 * Join; a 404 (unknown, private, or a person) falls back to the Add contact
 * dialog (which 404s unknown handles the same way). Any other lookup
 * failure (500, 429, network) shows an error state with Retry — a stranger
 * opening a share link during an outage is never prompted to send a contact
 * request against a group handle. Logged out goes to login and comes back
 * to the real URL.
 */
export function GroupHandleRoute({ atHandle }: { atHandle?: string | undefined }) {
  const auth = useAuth();
  const params = useParams<{ handle?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  // The real URL the visitor opened: `/@ada` or `/u/ada`. Recorded for the
  // login return trip, so the card reopens where the link pointed.
  const here = `${location.pathname}${location.search}`;
  const handle = atHandle ?? params.handle ?? '';

  // Resolve the handle once the session is known. Until then (and with no
  // handle) the lookup never runs, so the view stays on "checking".
  const [lookup, retryLookup] = useQuery(
    (): Effect.Effect<Lookup, ApiFailure> =>
      auth.status === 'authenticated' && handle !== '' ? lookupHandle(handle) : Effect.never,
    [auth.status, handle],
  );
  // A changed handle keeps the last settled view on screen until its own
  // lookup lands (as the old code did), so the Add contact dialog does not
  // flash. A Retry clears it first, so the retry shows the dialog again.
  // The settled view is kept with the lookup it came from; a new settled lookup
  // replaces it during render (React's "adjust state while rendering" pattern).
  const [kept, setKept] = useState<{ readonly from: LookupState; readonly view: LookupView }>();
  const fresh = lookupView(lookup);
  if (fresh.state !== 'checking' && kept?.from !== lookup) {
    setKept({ from: lookup, view: fresh });
  }
  const view = fresh.state === 'checking' ? (kept?.view ?? fresh) : fresh;

  if (auth.status === 'loading') {
    return null;
  }
  if (auth.status === 'guest') {
    return <Navigate to="/login" replace state={{ from: here }} />;
  }

  const close = (): void => {
    setOpen(false);
    navigate('/', { replace: true });
  };

  if (!open) {
    return null;
  }
  if (view.state === 'group') {
    // Keyed by handle so /@one then /@two re-seeds the card state.
    return <GroupHandleCard key={handle} entry={view.entry} onClose={close} />;
  }
  if (view.state === 'person' || view.state === 'checking') {
    // While checking, the prefilled Add contact dialog shows at once (what
    // the route rendered before groups existed): a person never sees a
    // flash, a group swaps to its card when the lookup lands, and a failed
    // lookup replaces it with the error state below — never a stuck dialog.
    return <AddContactDialog key={handle} initialHandle={handle} onClose={close} />;
  }
  if (view.state === 'error') {
    return (
      <Dialog
        open
        onClose={close}
        title="Couldn't open this link"
        ariaLabel={`Open @${handle}`}
        size="sm"
        actions={
          <>
            <Button
              type="button"
              size="lg"
              onClick={() => {
                setKept(undefined);
                retryLookup();
              }}
            >
              Retry
            </Button>
            <Button type="button" variant="ghost" size="lg" onClick={close}>
              Close
            </Button>
          </>
        }
      >
        <p role="alert" className="mt-2 text-center text-[14px] text-muted-foreground">
          {view.message}
        </p>
      </Dialog>
    );
  }
  return null;
}

function GroupHandleCard({ entry, onClose }: { entry: DirectoryEntry; onClose: () => void }) {
  const storeApi = useChatStoreApi();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // The join runs in the background, not tied to this card: closing it (which
  // unmounts the card) must not cancel the navigation that follows the join.
  const join = (): void => {
    if (busy) {
      return;
    }
    if (entry.joined) {
      onClose();
      Effect.runFork(
        attempt(() => storeApi.getState().refreshGeneralTopic(entry.id)).pipe(
          Effect.orElseSucceed(() => undefined),
          Effect.flatMap((chatId) =>
            Effect.sync(() => {
              navigate(chatId === undefined ? '/' : `/c/${encodeURIComponent(chatId)}`);
            }),
          ),
        ),
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    Effect.runFork(
      attempt(() => storeApi.getState().joinPublicGroup(entry.id)).pipe(
        Effect.flatMap((chatId) =>
          Effect.sync(() => {
            storeApi.getState().refreshChats();
            onClose();
            navigate(chatId === undefined ? '/' : `/c/${encodeURIComponent(chatId)}`);
          }),
        ),
        Effect.tapError((joinError) =>
          Effect.sync(() => {
            setError(
              joinError instanceof ApiError && joinError.code === 'group_full'
                ? 'That group is full right now.'
                : joinError instanceof ApiError && joinError.code === 'not_found'
                  ? 'That group is no longer public.'
                  : 'Could not join. Try again.',
            );
            setBusy(false);
          }),
        ),
        Effect.catchCause(() => Effect.void),
      ),
    );
  };

  return (
    <Dialog open onClose={onClose} title={entry.title} ariaLabel={`Join ${entry.title}`} size="sm">
      <div className="text-center">
        <div className="flex justify-center">
          <Avatar id={entry.id} name={entry.title} size={56} avatarUrl={entry.avatarUrl} />
        </div>
        <p className="mt-1 text-[14px] text-muted-foreground">@{entry.handle}</p>
        {entry.description !== null && entry.description !== '' && (
          <p className="mt-2 text-[15px] text-muted-foreground">{entry.description}</p>
        )}
        <p className="mt-2 text-[14px] text-muted-foreground">
          {entry.memberCount} {entry.memberCount === 1 ? 'member' : 'members'}
          {entry.kind === 'channel' ? ' · Channel' : ''}
        </p>
        {error !== undefined && (
          <p role="alert" className="mt-3 text-[14px] text-danger">
            {error}
          </p>
        )}
        <Button
          type="button"
          size="lg"
          disabled={busy}
          onClick={() => join()}
          className="mt-5 w-full"
        >
          {busy
            ? 'Joining…'
            : entry.joined
              ? 'Open'
              : entry.kind === 'channel'
                ? 'Join the channel'
                : 'Join the group'}
        </Button>
        <div className="mt-3 flex justify-center">
          <Button type="button" variant="ghost" size="lg" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
