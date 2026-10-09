import { Data, Effect } from 'effect';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ApiError,
  searchDirectory,
  type DirectoryEntry,
  type SearchDirectoryInput,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { toApiFailure, type ApiFailure } from '@/lib/effect/errors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
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

/** A chat-store call rejected with a plain Error: the sentence is the store's own. */
class StoreFailed extends Data.TaggedError('StoreFailed')<{ readonly message: string }> {}

type JoinFailure = ApiFailure | StoreFailed;

/**
 * Lifts a chat-store call. An ApiError keeps its code (as in api.ts), a plain
 * Error keeps its message, and any other value becomes the generic failure.
 */
function fromStore<A>(call: () => Promise<A>): Effect.Effect<A, JoinFailure> {
  return Effect.tryPromise({
    try: call,
    catch: (cause) =>
      cause instanceof Error && !(cause instanceof ApiError)
        ? new StoreFailed({ message: cause.message })
        : toApiFailure(cause),
  });
}

/** The directory query for the search text and the kind filter. */
const searchInput = (query: string, kind: KindFilter): SearchDirectoryInput => ({
  ...(query === '' ? {} : { q: query }),
  ...(kind === 'all' ? {} : { kind }),
});

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
  const [errorMessage, setErrorMessage] = useState('');
  const [joiningId, setJoiningId] = useState<string | undefined>(undefined);
  const [joinError, setJoinError] = useState<string | undefined>(undefined);

  const trimmed = query.trim();

  // The first page, debounced: the 300 ms sleep is the debounce, and useQuery
  // interrupts it when the query or the kind changes. A query under 2
  // characters (but not empty) waits for more typing instead of erroring.
  const [, reloadFirstPage] = useQuery(
    () =>
      trimmed !== '' && trimmed.length < 2
        ? Effect.void
        : Effect.sleep(300).pipe(
            Effect.andThen(
              Effect.sync(() => {
                setState('loading');
                setJoinError(undefined);
              }),
            ),
            Effect.andThen(fromApi(() => searchDirectory(searchInput(trimmed, kind)))),
            Effect.tap((page) =>
              Effect.sync(() => {
                setEntries(page.entries);
                setNext(page.next);
                setState('ready');
              }),
            ),
            Effect.catchTag('ApiFailure', (failure) =>
              Effect.sync(() => {
                setState('error');
                setErrorMessage(
                  failure.code === 'rate_limited'
                    ? 'Too many searches — wait a little and try again.'
                    : 'Could not load the directory. Try again.',
                );
              }),
            ),
          ),
    [trimmed, kind],
  );

  const [moreState, loadMore] = useAction((cursor: string) =>
    fromApi(() => searchDirectory({ ...searchInput(trimmed, kind), cursor })).pipe(
      Effect.tap((page) =>
        Effect.sync(() => {
          setEntries((current) => [...current, ...page.entries]);
          setNext(page.next);
        }),
      ),
      Effect.tapError(() => Effect.sync(() => setJoinError('Could not load more. Try again.'))),
    ),
  );

  // Already joined: open the group chat. The General chat keeps the group's
  // chat id, resolved from the painted list like JoinPage does. The dialog
  // closes only after the id is known, so the navigation is never cut short.
  const openGroup = (entry: DirectoryEntry): Effect.Effect<void> =>
    Effect.tryPromise({
      try: () => storeApi.getState().refreshGeneralTopic(entry.id),
      catch: () => undefined,
    }).pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.tap((chatId) =>
        Effect.sync(() => {
          onClose();
          navigate(chatId === undefined ? '/' : `/c/${encodeURIComponent(chatId)}`);
        }),
      ),
      Effect.asVoid,
    );

  const joinGroup = (entry: DirectoryEntry): Effect.Effect<void, JoinFailure> =>
    Effect.sync(() => {
      setJoinError(undefined);
      setJoiningId(entry.id);
    }).pipe(
      Effect.andThen(fromStore(() => storeApi.getState().joinPublicGroup(entry.id))),
      Effect.tap((chatId) =>
        Effect.sync(() => {
          storeApi.getState().refreshChats();
          onClose();
          navigate(chatId === undefined ? '/' : `/c/${encodeURIComponent(chatId)}`);
        }),
      ),
      Effect.tapError((failure) => Effect.sync(() => setJoinError(friendlyJoinError(failure)))),
      Effect.ensuring(Effect.sync(() => setJoiningId(undefined))),
      Effect.asVoid,
    );

  const [, joinOrOpen] = useAction<DirectoryEntry, void, JoinFailure>((entry) =>
    entry.joined ? openGroup(entry) : joinGroup(entry),
  );

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
        {state === 'loading' && <StateMessage kind="loading" title="Searching…" />}
        {state === 'error' && (
          <StateMessage
            kind="error"
            title={errorMessage}
            action={{
              label: 'Retry',
              onClick: () => {
                setState('loading');
                reloadFirstPage();
              },
            }}
          />
        )}
        {state === 'ready' && entries.length === 0 && (
          <StateMessage
            kind="empty"
            title={
              trimmed === ''
                ? 'No public groups or channels yet. Be the first to make one public.'
                : `Nothing public matches “${trimmed}”. Try another name or @handle.`
            }
          />
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
                onClick={() => joinOrOpen(entry)}
                className="shrink-0"
              >
                {joiningId === entry.id ? 'Joining…' : entry.joined ? 'Open' : 'Join'}
              </Button>
            </div>
          ))}
        {state === 'ready' && next !== null && (
          <div className="flex justify-center py-2">
            <Button
              type="button"
              variant="outline"
              disabled={isWaiting(moreState)}
              onClick={() => {
                if (next !== null) {
                  loadMore(next);
                }
              }}
            >
              {isWaiting(moreState) ? 'Loading…' : 'Show more'}
            </Button>
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

function friendlyJoinError(error: JoinFailure): string {
  if (error._tag === 'StoreFailed') {
    return error.message;
  }
  switch (error.code) {
    case 'group_full':
      return 'That group is full right now.';
    case 'not_found':
      return 'That group is no longer public.';
    case 'rate_limited':
      return 'Too many joins — wait a little and try again.';
    case 'unknown_error':
      return 'Could not join. Try again.';
    default:
      return error.message;
  }
}
