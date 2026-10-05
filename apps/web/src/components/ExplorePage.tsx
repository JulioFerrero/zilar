import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, searchDirectory, type DirectoryEntry } from '@/lib/api';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { Avatar } from '@/components/Avatar';
import { cn } from '@/lib/utils';

type KindFilter = 'all' | 'group' | 'channel';

const PAGE_TITLE = 'Explore public groups and channels';

/**
 * Explore (T-0164): an overlay reachable from the chat list, the + new chat
 * menu and the empty state. Searches public groups and channels only (by
 * handle or title prefix, at least 2 characters; empty lists the newest),
 * with a Groups / Channels filter. Each row shows the title, `@handle`,
 * description, member count and a Join button (or Open when already
 * joined). Empty and error states are real messages, never blank.
 */
export function ExplorePage({ onClose }: { onClose: () => void }) {
  const storeApi = useChatStoreApi();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  // Bumped to re-run the search (the Retry button and the kind filter
  // share it — changing either refetches).
  const [attempt, setAttempt] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [joiningId, setJoiningId] = useState<string | undefined>(undefined);
  const [joinError, setJoinError] = useState<string | undefined>(undefined);

  const trimmed = query.trim();

  // Debounced search: the effect only schedules the fetch; the timeout
  // callback applies the loading state and the promise callback the rows
  // once (the lint rule flags synchronous setState inside effects). A query
  // under 2 characters (but not empty) waits for more typing instead of
  // erroring.
  useEffect(() => {
    if (trimmed !== '' && trimmed.length < 2) {
      return;
    }
    let active = true;
    const pending = setTimeout(() => {
      if (!active) {
        return;
      }
      setState('loading');
      setJoinError(undefined);
      void searchDirectory({
        ...(trimmed === '' ? {} : { q: trimmed }),
        ...(kind === 'all' ? {} : { kind }),
      }).then(
        (page) => {
          if (active) {
            setEntries(page.entries);
            setNext(page.next);
            setState('ready');
          }
        },
        (error: unknown) => {
          if (!active) {
            return;
          }
          setState('error');
          setErrorMessage(
            error instanceof ApiError && error.code === 'rate_limited'
              ? 'Too many searches — wait a little and try again.'
              : 'Could not load the directory. Try again.',
          );
        },
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(pending);
    };
  }, [trimmed, kind, attempt]);

  // Esc closes the overlay from any focus position, same as Close.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const loadMore = async (): Promise<void> => {
    if (next === null || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await searchDirectory({
        ...(trimmed === '' ? {} : { q: trimmed }),
        ...(kind === 'all' ? {} : { kind }),
        cursor: next,
      });
      setEntries((current) => [...current, ...page.entries]);
      setNext(page.next);
    } catch {
      setJoinError('Could not load more. Try again.');
    } finally {
      setLoadingMore(false);
    }
  };

  const join = async (entry: DirectoryEntry): Promise<void> => {
    // Already joined: open the group chat (the General chat keeps the
    // group's chat id — resolve it from the painted list like JoinPage).
    if (entry.joined) {
      onClose();
      const chatId = await storeApi
        .getState()
        .refreshGeneralTopic(entry.id)
        .catch(() => undefined);
      navigate(chatId === undefined ? '/' : `/c/${encodeURIComponent(chatId)}`);
      return;
    }
    if (joiningId !== undefined) {
      return;
    }
    setJoiningId(entry.id);
    setJoinError(undefined);
    try {
      const chatId = await storeApi.getState().joinPublicGroup(entry.id);
      storeApi.getState().refreshChats();
      onClose();
      navigate(chatId === undefined ? '/' : `/c/${encodeURIComponent(chatId)}`);
    } catch (error) {
      setJoinError(friendlyJoinError(error));
    } finally {
      setJoiningId(undefined);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={PAGE_TITLE}
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-background p-5 shadow-xl"
      >
        <h2 className="text-[18px] font-semibold">Explore</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">
          Public groups and channels anyone can join.
        </p>
        <input
          autoFocus
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or @handle"
          aria-label="Search public groups and channels"
          className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
        />
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Kind filter">
          {(
            [
              { value: 'all', label: 'All' },
              { value: 'group', label: 'Groups' },
              { value: 'channel', label: 'Channels' },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className={cn(
                'cursor-pointer rounded-full border px-3 py-1 text-[14px]',
                kind === option.value
                  ? 'border-accent bg-accent/10 font-medium'
                  : 'border-input text-muted-foreground',
              )}
            >
              <input
                type="radio"
                name="explore-kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>

        <div aria-live="polite" className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {state === 'loading' && (
            <p className="py-6 text-center text-[14px] text-muted-foreground">Searching…</p>
          )}
          {state === 'error' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p role="alert" className="text-[14px] text-danger">
                {errorMessage}
              </p>
              <button
                type="button"
                onClick={() => {
                  setState('loading');
                  setAttempt((value) => value + 1);
                }}
                className="rounded-full border border-border px-4 py-1.5 text-[14px] hover:bg-surface-raised"
              >
                Retry
              </button>
            </div>
          )}
          {state === 'ready' && entries.length === 0 && (
            <p className="py-6 text-center text-[14px] text-muted-foreground">
              {trimmed === ''
                ? 'No public groups or channels yet. Be the first to make one public.'
                : `Nothing public matches “${trimmed}”. Try another name or @handle.`}
            </p>
          )}
          {state === 'ready' &&
            entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-list-hover"
              >
                <Avatar id={entry.id} name={entry.title} size={36} avatarUrl={entry.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">
                    {entry.title}{' '}
                    <span className="font-normal text-muted-foreground">@{entry.handle}</span>
                  </p>
                  {entry.description !== null && entry.description !== '' && (
                    <p className="truncate text-[13px] text-muted-foreground">
                      {entry.description}
                    </p>
                  )}
                  <p className="text-[13px] text-muted-foreground">
                    {entry.memberCount} {entry.memberCount === 1 ? 'member' : 'members'}
                    {entry.kind === 'channel' ? ' · Channel' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={joiningId !== undefined}
                  onClick={() => void join(entry)}
                  className="shrink-0 rounded-full bg-accent px-4 py-1.5 text-[14px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
                >
                  {joiningId === entry.id ? 'Joining…' : entry.joined ? 'Open' : 'Join'}
                </button>
              </div>
            ))}
          {state === 'ready' && next !== null && (
            <div className="flex justify-center py-2">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="rounded-full border border-border px-4 py-1.5 text-[14px] hover:bg-surface-raised disabled:opacity-60"
              >
                {loadingMore ? 'Loading…' : 'Show more'}
              </button>
            </div>
          )}
          {joinError !== undefined && (
            <p role="alert" className="py-2 text-center text-[14px] text-danger">
              {joinError}
            </p>
          )}
        </div>

        <div className="mt-4 flex justify-end">
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

function friendlyJoinError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'group_full':
        return 'That group is full right now.';
      case 'not_found':
        return 'That group is no longer public.';
      case 'rate_limited':
        return 'Too many joins — wait a little and try again.';
      default:
        return error.message;
    }
  }
  return 'Could not join. Try again.';
}
