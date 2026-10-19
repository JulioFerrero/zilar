import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ApiError, lookupGroupByHandle, type DirectoryEntry } from '@/lib/api';
import { fromApi, fromThrown, type ApiFailure } from '@zilar/client-core';
import { failureOf, isWaiting } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { AddContactDialog } from '@/components/AddContactDialog';
import { EntityAvatar } from '@/components/EntityAvatar';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

type Lookup =
  { readonly state: 'group'; readonly entry: DirectoryEntry } | { readonly state: 'person' };

type LookupState = AsyncResult.AsyncResult<Lookup, ApiFailure>;

type LookupView =
  Lookup | { readonly state: 'checking' } | { readonly state: 'error'; readonly message: string };

/** One lookup of the handle. The zero-delay sleep is the old setTimeout(0): the lookup
 * starts on the next turn, and a change of the handle or the session interrupts it. */
function lookupHandle(handle: string): Effect.Effect<Lookup, ApiFailure> {
  return Effect.sleep(0).pipe(
    Effect.andThen(fromApi(() => lookupGroupByHandle(handle))),
    Effect.map((entry): Lookup => ({ state: 'group', entry })),
    Effect.catchIf(
      (failure: ApiFailure) => failure.status === 404,
      () => Effect.succeed<Lookup>({ state: 'person' }),
    ),
  );
}

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

/** The /@handle share entry: a person or a public group. A public group opens a card with
 * Join; a 404 falls back to the Add contact dialog. Any other failure shows an error with
 * Retry, so an outage never prompts a stranger to send a request against a group handle. */
export function useShareEntry(atHandle: string | undefined) {
  const auth = useAuth();
  const params = useParams<{ handle?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  // The real URL the visitor opened, recorded for the login return trip.
  const here = `${location.pathname}${location.search}`;
  const handle = atHandle ?? params.handle ?? '';
  const close = (): void => {
    setOpen(false);
    navigate('/', { replace: true });
  };
  return { auth, here, handle, open, close };
}

export function GroupHandleRoute({ atHandle }: { atHandle?: string | undefined }) {
  const { auth, here, handle, open, close } = useShareEntry(atHandle);

  // Resolve the handle once the session is known; until then the view stays on checking.
  const [lookup, retryLookup] = useQuery(
    (): Effect.Effect<Lookup, ApiFailure> =>
      auth.status === 'authenticated' && handle !== '' ? lookupHandle(handle) : Effect.never,
    [auth.status, handle],
  );
  // A changed handle keeps the last settled view so the dialog does not flash; a Retry clears
  // it first. The view is kept with the lookup it came from and replaced during render.
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

  if (!open) {
    return null;
  }
  if (view.state === 'group') {
    return <GroupHandleCard key={handle} entry={view.entry} onClose={close} />;
  }
  if (view.state === 'person' || view.state === 'checking') {
    // While checking, the prefilled Add contact dialog shows at once, so a person never sees a
    // flash; a group swaps to its card, and a failed lookup replaces it with the error state.
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
        error={view.message}
        footer={
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
        }
      />
    );
  }
  return null;
}

function GroupHandleCard({ entry, onClose }: { entry: DirectoryEntry; onClose: () => void }) {
  const storeApi = useChatStoreApi();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // The join runs in the background: closing the card must not cancel the navigation after it.
  const join = (): void => {
    if (busy) {
      return;
    }
    if (entry.joined) {
      onClose();
      Effect.runFork(
        fromThrown(() => storeApi.getState().refreshGeneralTopic(entry.id)).pipe(
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
      fromThrown(() => storeApi.getState().joinPublicGroup(entry.id)).pipe(
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
    <Dialog
      open
      onClose={onClose}
      title={entry.title}
      ariaLabel={`Join ${entry.title}`}
      size="sm"
      busy={busy}
      error={error}
      footer={
        <Button type="button" size="lg" disabled={busy} onClick={() => join()}>
          {busy
            ? 'Joining…'
            : entry.joined
              ? 'Open'
              : entry.kind === 'channel'
                ? 'Join the channel'
                : 'Join the group'}
        </Button>
      }
    >
      <div className="text-center">
        <div className="flex justify-center">
          <EntityAvatar chat={entry} size={56} />
        </div>
        <p className="mt-1 text-[14px] text-muted-foreground">@{entry.handle}</p>
        {entry.description !== null && entry.description !== '' && (
          <p className="mt-2 text-[15px] text-muted-foreground">{entry.description}</p>
        )}
        <p className="mt-2 text-[14px] text-muted-foreground">
          {entry.memberCount} {entry.memberCount === 1 ? 'member' : 'members'}
          {entry.kind === 'channel' ? ' · Channel' : ''}
        </p>
      </div>
    </Dialog>
  );
}
