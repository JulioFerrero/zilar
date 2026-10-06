import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ApiError, lookupGroupByHandle, type DirectoryEntry } from '@/lib/api';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { AddContactDialog } from '@/components/AddContactDialog';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

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

  const [lookup, setLookup] = useState<
    | { state: 'checking' }
    | { state: 'group'; entry: DirectoryEntry }
    | { state: 'person' }
    | { state: 'error'; message: string }
  >({ state: 'checking' });
  // Bumped to re-run the lookup (the Retry button shares it).
  const [attempt, setAttempt] = useState(0);

  // Resolve the handle once the session is known: a public group shows the
  // group card; a 404 falls back to the Add contact dialog; anything else
  // is an error with Retry. The effect only schedules the lookup.
  useEffect(() => {
    if (auth.status !== 'authenticated' || handle === '') {
      return;
    }
    let active = true;
    const pending = setTimeout(() => {
      void lookupGroupByHandle(handle).then(
        (entry) => {
          if (active) {
            setLookup({ state: 'group', entry });
          }
        },
        (error: unknown) => {
          if (!active) {
            return;
          }
          if (error instanceof ApiError && error.status === 404) {
            setLookup({ state: 'person' });
            return;
          }
          setLookup({
            state: 'error',
            message:
              error instanceof ApiError && error.code === 'rate_limited'
                ? 'Too many lookups — wait a little and try again.'
                : 'Could not open that link. Try again.',
          });
        },
      );
    }, 0);
    return () => {
      active = false;
      clearTimeout(pending);
    };
  }, [auth.status, handle, attempt]);

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
  if (lookup.state === 'group') {
    // Keyed by handle so /@one then /@two re-seeds the card state.
    return <GroupHandleCard key={handle} entry={lookup.entry} onClose={close} />;
  }
  if (lookup.state === 'person' || lookup.state === 'checking') {
    // While checking, the prefilled Add contact dialog shows at once (what
    // the route rendered before groups existed): a person never sees a
    // flash, a group swaps to its card when the lookup lands, and a failed
    // lookup replaces it with the error state below — never a stuck dialog.
    return <AddContactDialog key={handle} initialHandle={handle} onClose={close} />;
  }
  if (lookup.state === 'error') {
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
                setLookup({ state: 'checking' });
                setAttempt((value) => value + 1);
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
          {lookup.message}
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

  const join = async (): Promise<void> => {
    if (busy) {
      return;
    }
    if (entry.joined) {
      onClose();
      const chatId = await storeApi
        .getState()
        .refreshGeneralTopic(entry.id)
        .catch(() => undefined);
      navigate(chatId === undefined ? '/' : `/c/${encodeURIComponent(chatId)}`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const chatId = await storeApi.getState().joinPublicGroup(entry.id);
      storeApi.getState().refreshChats();
      onClose();
      navigate(chatId === undefined ? '/' : `/c/${encodeURIComponent(chatId)}`);
    } catch (joinError) {
      setError(
        joinError instanceof ApiError && joinError.code === 'group_full'
          ? 'That group is full right now.'
          : joinError instanceof ApiError && joinError.code === 'not_found'
            ? 'That group is no longer public.'
            : 'Could not join. Try again.',
      );
      setBusy(false);
    }
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
          onClick={() => void join()}
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
