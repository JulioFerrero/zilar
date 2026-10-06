import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, searchDirectory, type DirectoryEntry } from '@/lib/api';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SearchField } from '@/components/ui/search-field';

type KindFilter = 'all' | 'group' | 'channel';

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'group', label: 'Groups' },
  { value: 'channel', label: 'Channels' },
];

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
  const searchRef = useRef<HTMLInputElement>(null);
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
    <Dialog
      open
      onClose={onClose}
      title="Explore"
      ariaLabel={PAGE_TITLE}
      size="md"
      initialFocusRef={searchRef}
      actions={
        <Button type="button" size="lg" onClick={onClose}>
          Close
        </Button>
      }
    >
      <p className="mt-1 text-[14px] text-muted-foreground">
        Public groups and channels anyone can join.
      </p>
      <SearchField
        ref={searchRef}
        value={query}
        maxLength={100}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by name or @handle"
        aria-label="Search public groups and channels"
        className="mt-3"
      />
      <div className="mt-2">
        <SegmentedControl
          mode="radio"
          ariaLabel="Kind filter"
          options={KIND_OPTIONS}
          value={kind}
          onChange={(next) => {
            const match = KIND_OPTIONS.find((option) => option.value === next);
            if (match !== undefined) {
              setKind(match.value);
            }
          }}
        />
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
                  <p className="truncate text-[13px] text-muted-foreground">{entry.description}</p>
                )}
                <p className="text-[13px] text-muted-foreground">
                  {entry.memberCount} {entry.memberCount === 1 ? 'member' : 'members'}
                  {entry.kind === 'channel' ? ' · Channel' : ''}
                </p>
              </div>
              <Button
                type="button"
                disabled={joiningId !== undefined}
                onClick={() => void join(entry)}
                className="shrink-0"
              >
                {joiningId === entry.id ? 'Joining…' : entry.joined ? 'Open' : 'Join'}
              </Button>
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
    </Dialog>
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
