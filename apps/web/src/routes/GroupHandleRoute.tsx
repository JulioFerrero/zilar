import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ApiError, lookupGroupByHandle, type DirectoryEntry } from '@/lib/api';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { AddContactDialog } from '@/components/AddContactDialog';
import { Avatar } from '@/components/Avatar';

/**
 * The `/@handle` share entry (T-0164): resolves a person or a public group.
 * A public group opens a card with title, description, member count and
 * Join; anything else falls back to the Add contact dialog (which 404s
 * unknown handles the same way). Logged out goes to login and comes back
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
    { state: 'checking' } | { state: 'group'; entry: DirectoryEntry } | { state: 'person' }
  >({ state: 'checking' });

  // Resolve the handle once the session is known: a public group shows the
  // group card, anything else (a person, unknown, private) falls back to
  // the Add contact dialog. The effect only schedules the lookup.
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
          setLookup({ state: 'person' });
        },
      );
    }, 0);
    return () => {
      active = false;
      clearTimeout(pending);
    };
  }, [auth.status, handle]);

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
  if (lookup.state === 'person') {
    return <AddContactDialog key={handle} initialHandle={handle} onClose={close} />;
  }
  return null;
}

function GroupHandleCard({ entry, onClose }: { entry: DirectoryEntry; onClose: () => void }) {
  const storeApi = useChatStoreApi();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Esc closes the card from any focus position, same as Close.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Join ${entry.title}`}
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-background p-6 text-center shadow-xl"
      >
        <div className="flex justify-center">
          <Avatar id={entry.id} name={entry.title} size={56} />
        </div>
        <h2 className="mt-3 text-[20px] font-semibold">{entry.title}</h2>
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
        <button
          type="button"
          disabled={busy}
          onClick={() => void join()}
          className="mt-5 w-full rounded-full bg-accent px-4 py-2.5 text-[15px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
        >
          {busy
            ? 'Joining…'
            : entry.joined
              ? 'Open'
              : entry.kind === 'channel'
                ? 'Join the channel'
                : 'Join the group'}
        </button>
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-[15px] text-muted-foreground hover:bg-list-hover"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
