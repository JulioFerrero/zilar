import { ChatListMenu } from './chatList/ChatListMenu';
import { GroupHeaderRow } from './chatList/GroupHeaderRow';
import { RequestRows as ContactRequestsRow } from './chatList/RequestRows';
import {
  APPROVAL_BADGE_CAP,
  CONNECTION_BANNER_DELAY_MS,
  createRowsSelector,
  InstallFailed,
  statusLabel,
} from './chatList/rowsSelector';
import { ChatListItem } from './ChatListItem';
import { ConfirmDialog } from './ConfirmDialog';
import { EmptyState } from './EmptyState';
import { folderIconComponent } from './folderIcon';
import { InviteDialog } from './InviteDialog';
import { MessageSearchResults } from './MessageSearchResults';
import { NewChatButton } from './NewChatButton';
import { NewTopicDialog } from './NewTopicDialog';
import { PeopleSearchResult } from './PeopleSearchResult';
import { ChatListSkeleton } from './Skeleton';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Chip } from './ui/chip';
import { StateMessage } from './ui/state-message';
import { Well } from './ui/well';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useInstallPrompt } from '@/lib/push';
import { useContactRequestCount } from '@/lib/useContactRequestCount';
import { useIsServerOwner } from '@/lib/useIsServerOwner';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { usePendingApprovalCount } from '@/lib/usePendingApprovalCount';
import { normalizePeopleQuery, PEOPLE_SEARCH_MIN_LENGTH } from '@/lib/usePeopleSearch';
import { cn } from '@/lib/utils';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { folderUnreadTotal } from '@zilar/chat-core';
import { peopleHandleFor, useDelayed } from '@zilar/client-core';
import { Effect, Schema } from 'effect';
import { Archive, Loader2, Search, LayoutGrid } from 'lucide-react';
import {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';

const COLLAPSED_KEY = 'zilar:collapsedGroups';
const ARCHIVED_KEY = 'zilar:archivedOpen';

// The stored value is a JSON array; anything else reads as empty.
const decodeStoredList = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Schema.Unknown)),
);

/** A blocked or missing storage gives fallback, so the list keeps working without it. */
function storageStep<A>(fallback: A, step: (storage: Storage) => A): A {
  return Effect.runSync(
    Effect.try(() => step(window.localStorage)).pipe(Effect.orElseSucceed(() => fallback)),
  );
}

function readSet(key: string): Set<string> {
  const raw = storageStep<string | null>(null, (storage) => storage.getItem(key));
  // A corrupt or blocked storage must never break the list.
  const entries =
    raw === null
      ? []
      : Effect.runSync(
          Effect.try(() => decodeStoredList(raw)).pipe(Effect.orElseSucceed(() => [])),
        );
  return new Set(entries.filter((entry): entry is string => typeof entry === 'string'));
}

function writeSet(key: string, value: Set<string>): void {
  // Ignore a full or blocked storage.
  storageStep<void>(undefined, (storage) => {
    storage.setItem(key, JSON.stringify([...value]));
  });
}

function readCollapsedGroups(): Set<string> {
  return readSet(COLLAPSED_KEY);
}

function toggleCollapsedGroup(current: Set<string>, groupId: string): Set<string> {
  const next = new Set(current);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  writeSet(COLLAPSED_KEY, next);
  return next;
}

function readArchivedOpen(): Set<string> {
  return readSet(ARCHIVED_KEY);
}

function toggleArchivedOpen(current: Set<string>, groupId: string): Set<string> {
  const next = new Set(current);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  writeSet(ARCHIVED_KEY, next);
  return next;
}

/**
 * Arrow keys move focus between `data-topic-row` rows inside the chat list;
 * links elsewhere on the page never take part.
 */
function TopicKeyboardNav({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    // Alt/Ctrl/Meta+arrows belong to the window-level chat switch.
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') {
      return;
    }
    const root = event.currentTarget;
    const list = root.closest('nav[aria-label="Chats"]') ?? root;
    const links = Array.from(list.querySelectorAll<HTMLAnchorElement>('a[data-topic-row]'));
    const current = document.activeElement;
    const index = links.findIndex((link) => link === current);
    if (event.key === 'Enter') {
      if (current instanceof HTMLAnchorElement && links.includes(current)) {
        event.preventDefault();
        navigate(current.getAttribute('href') ?? '/');
      }
      return;
    }
    event.preventDefault();
    if (links.length === 0) {
      return;
    }
    const next =
      index === -1
        ? (links[0] as HTMLAnchorElement)
        : event.key === 'ArrowDown'
          ? (links[(index + 1) % links.length] as HTMLAnchorElement)
          : (links[(index - 1 + links.length) % links.length] as HTMLAnchorElement);
    next.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

function SearchBar() {
  const chats = useChatSelector((s) => s.chats);
  const searchChat = useChatSelector((s) => s.searchChat);
  const search = useChatSelector((s) => s.search);
  const setSearch = useChatSelector((s) => s.setSearch);
  const storeApi = useChatStoreApi();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onFocusSearch = (): void => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('zilar:focus-search', onFocusSearch);
    return () => window.removeEventListener('zilar:focus-search', onFocusSearch);
  }, []);

  const scopedChat =
    searchChat === undefined ? undefined : chats.find((chat) => chat.id === searchChat);
  const clearScope = (): void => {
    storeApi.getState().setSearchChat(undefined);
  };

  return (
    <Well className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2.5">
      <Search className="size-[15px] shrink-0 text-subtle-foreground" aria-hidden="true" />
      {scopedChat !== undefined && (
        <Chip
          tone="accent"
          onClick={clearScope}
          title={`Searching only in ${scopedChat.title} — click to search everywhere`}
          ariaLabel={`Searching only in ${scopedChat.title}. Activate to search all chats.`}
          className="max-w-[120px] shrink-0 truncate text-[11px]"
        >
          {scopedChat.title}
        </Chip>
      )}
      <input
        ref={inputRef}
        id="chat-search"
        name="chat-search"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            window.dispatchEvent(new Event('zilar:search-enter'));
            return;
          }
          if (event.key === 'Escape') {
            if (search !== '') {
              event.preventDefault();
              setSearch('');
            } else {
              inputRef.current?.blur();
            }
          }
        }}
        placeholder={
          scopedChat === undefined ? 'Search, or type @username' : `Search in ${scopedChat.title}`
        }
        aria-label={scopedChat === undefined ? 'Search chats' : `Search in ${scopedChat.title}`}
        className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-subtle-foreground"
      />
      <kbd className="font-mono hidden shrink-0 rounded-md border border-border-strong px-1.5 py-px text-[11px] leading-4 text-subtle-foreground wide:inline-block">
        ⌘K
      </kbd>
    </Well>
  );
}

function FolderTabs() {
  const folders = useChatSelector((s) => s.folders);
  const chats = useChatSelector((s) => s.chats);
  const activeFolder = useChatSelector((s) => s.activeFolder);
  const setActiveFolder = useChatSelector((s) => s.setActiveFolder);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const tabs: { id: string; label: string; icon: typeof LayoutGrid | null; unread: number }[] = [
    { id: 'all', label: 'All chats', icon: null, unread: folderUnreadTotal('all', chats) },
    ...folders.map((folder) => ({
      id: folder.id,
      label: folder.name,
      icon: folderIconComponent(folder.icon),
      unread: folderUnreadTotal(folder, chats),
    })),
  ];

  const moveFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = tabs.length - 1;
    let next: number | undefined;
    if (event.key === 'ArrowRight') {
      next = index === last ? 0 : index + 1;
    } else if (event.key === 'ArrowLeft') {
      next = index === 0 ? last : index - 1;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = last;
    }
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    const tab = tabs[next];
    if (tab === undefined) {
      return;
    }
    setActiveFolder(tab.id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="shrink-0 px-3 pt-1 pb-2">
      <div
        role="tablist"
        aria-label="Chat folders"
        className="scrollbar-thin well-surface flex gap-1 overflow-x-auto rounded-[10px] p-[3px]"
      >
        {tabs.map((tab, index) => {
          const active = activeFolder === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveFolder(tab.id)}
              onKeyDown={(event) => moveFocus(event, index)}
              className={cn(
                'flex h-[30px] shrink-0 items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium transition-colors',
                active
                  ? 'segment-raised text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {Icon !== null && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
              {tab.label}
              {tab.unread > 0 && (
                <Badge
                  count={tab.unread}
                  muted={!active}
                  className="h-4 min-w-4 px-1 text-[10px] leading-4"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ChatList({ activeChatId }: { activeChatId: string | undefined }) {
  const storeApi = useChatStoreApi();
  const navigate = useNavigate();
  const selectRows = useMemo(() => createRowsSelector(), []);
  const rows = useChatSelector(selectRows);
  const storeChatCount = useChatSelector((s) => s.chats.length);
  const storeStatus = useChatSelector((s) => s.status);
  const chatsState = useChatSelector((s) => s.chatsState);
  const search = useChatSelector((s) => s.search);
  const searchChat = useChatSelector((s) => s.searchChat);
  const { chats, groups, archived } = rows;
  // An `@handle` query looks the person up exactly (like the phone); any other
  // query of 3+ characters shows the prefix hits.
  const showPeopleSearch =
    peopleHandleFor(search) !== null ||
    normalizePeopleQuery(search).length >= PEOPLE_SEARCH_MIN_LENGTH;
  const [menuOpen, setMenuOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [newTopicChatId, setNewTopicChatId] = useState<string | undefined>(undefined);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsedGroups());
  const [archivedOpen, setArchivedOpen] = useState<Set<string>>(() => readArchivedOpen());
  const toggleCollapse = useCallback(
    (groupId: string): void => setCollapsed((current) => toggleCollapsedGroup(current, groupId)),
    [],
  );
  const toggleArchived = useCallback(
    (groupId: string): void => setArchivedOpen((current) => toggleArchivedOpen(current, groupId)),
    [],
  );
  const isWide = useMediaQuery('(min-width: 900px)');
  const connection = useDelayed(statusLabel(storeStatus), CONNECTION_BANNER_DELAY_MS);
  // A retry keeps the painted list: only a list that never arrived shows skeletons.
  const hasAnyChats = storeChatCount > 0;
  const [retryingChats, setRetryingChats] = useState(false);
  // Reset during render when the retry settles, not in an effect, so the button cannot stick.
  const [lastChatsState, setLastChatsState] = useState(chatsState);
  if (chatsState !== lastChatsState) {
    setLastChatsState(chatsState);
    if (retryingChats && chatsState !== 'loading') {
      setRetryingChats(false);
    }
  }
  const retrying = retryingChats && chatsState === 'loading';
  const retryChats = (): void => {
    setRetryingChats(true);
    storeApi.getState().retryChats();
  };

  const signOut = (): void => {
    setMenuOpen(false);
    setConfirmingSignOut(true);
  };

  // Integrations is owner-only: the hook starts not-owner so it never flashes.
  const isServerOwner = useIsServerOwner();
  const pendingApprovals = usePendingApprovalCount(menuOpen);
  const incomingRequests = useContactRequestCount(true);
  // The browser offers `beforeinstallprompt` when Zilar is installable.
  const { installEvent, promptInstall } = useInstallPrompt();
  // The prompt must start from the click's user activation, so the action awaits that promise.
  const [installState, runInstall] = useAction<Promise<void>, void, InstallFailed>((prompt) =>
    Effect.tryPromise({ try: () => prompt, catch: () => new InstallFailed() }),
  );
  const installFailed = !isWaiting(installState) && failureOf(installState) !== undefined;
  const installing = isWaiting(installState);
  const install = (): void => runInstall(promptInstall());
  const approvalsBadge =
    pendingApprovals !== null && pendingApprovals > 0
      ? pendingApprovals > APPROVAL_BADGE_CAP
        ? '9+'
        : String(pendingApprovals)
      : null;

  const menu = (
    <ChatListMenu
      open={menuOpen}
      onOpenChange={setMenuOpen}
      isWide={isWide}
      onInvite={() => setInviteOpen(true)}
      onExplore={() => navigate('/explore')}
      onSignOut={signOut}
      isServerOwner={isServerOwner}
      incomingRequests={incomingRequests}
      approvalsBadge={approvalsBadge}
      installEvent={installEvent}
      installFailed={installFailed}
      installing={installing}
      onInstall={install}
    />
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-panel">
      {isWide ? (
        <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
          {menu}
          <SearchBar />
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between px-4 py-2">
            <h1 className="text-[28px] leading-8 font-semibold tracking-[-0.02em]">Chats</h1>
            {menu}
          </div>
          <div className="shrink-0 px-4 pt-1 pb-2.5">
            <SearchBar />
          </div>
        </>
      )}
      {!isWide && <FolderTabs />}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {connection !== undefined && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center"
          >
            <span className="rounded-full border border-border bg-surface-raised px-3 py-1 text-[12px] text-muted-foreground">
              {connection}
            </span>
          </div>
        )}
        <nav
          aria-label="Chats"
          className={cn(
            'scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto',
            isWide ? 'gap-0.5 px-2' : 'gap-0 pb-20',
          )}
        >
          {chatsState === 'loading' && !hasAnyChats ? (
            <ChatListSkeleton />
          ) : chatsState === 'error' && !hasAnyChats ? (
            <div className="flex h-full flex-col items-center justify-center p-8">
              <StateMessage
                kind="error"
                title="Couldn't load chats"
                action={{ label: 'Retry', onClick: retryChats }}
              />
            </div>
          ) : (
            <>
              {(chatsState === 'error' || retrying) && (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
                  <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-surface-raised py-1 pr-1 pl-3 shadow-sm">
                    <p role="status" className="text-[13px] text-muted-foreground">
                      {retrying ? 'Retrying…' : "Couldn't load chats"}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      disabled={retrying}
                      aria-busy={retrying || undefined}
                      onClick={retryChats}
                    >
                      {retrying && (
                        <Loader2
                          className="size-3.5 animate-spin motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                      )}
                      {retrying ? 'Retrying…' : 'Retry'}
                    </Button>
                  </div>
                </div>
              )}
              {search.trim() === '' && <ContactRequestsRow isWide={isWide} />}
              {/* People hits come first: 3+ characters (after stripping `@`) show matching
               * people and public groups, above chat-name matches and message hits.
               */}
              {showPeopleSearch && <PeopleSearchResult query={search} />}
              {chats.length === 0 && archived.length === 0 ? (
                search.trim() === '' ? (
                  <EmptyState
                    variant="no-chats"
                    onInvite={() => setInviteOpen(true)}
                    onExplore={() => navigate('/explore')}
                  />
                ) : (
                  <p className="px-[10px] py-2 text-[13px] text-muted-foreground">No chats match</p>
                )
              ) : (
                // `TopicKeyboardNav` grows with `flex-1`. Inside this scroll container a
                // `flex-1` item has a zero basis, so it collapsed to nothing once the message
                // hits below were taller and painted over the `Messages` section. A plain block
                // wrapper keeps the rows at their natural height and the whole list scrolls.
                <div className="shrink-0">
                  <TopicKeyboardNav>
                    {groups.map((group) =>
                      group.groupId === undefined ? (
                        <ChatListItem
                          key={group.key}
                          chat={group.topics[0]!}
                          selected={group.topics[0]!.id === activeChatId}
                          isWide={isWide}
                        />
                      ) : (
                        <GroupHeaderRow
                          key={group.key}
                          groupTitle={group.title}
                          groupId={group.groupId}
                          chat={
                            group.topics.find((topic) => topic.topic?.isGeneral === true) ??
                            group.topics[0]!
                          }
                          topics={group.topics}
                          selectedId={activeChatId}
                          collapsed={collapsed.has(group.groupId)}
                          onToggleCollapse={toggleCollapse}
                          archivedOpen={archivedOpen.has(group.groupId)}
                          onToggleArchived={toggleArchived}
                          isWide={isWide}
                          onOpenNewTopic={setNewTopicChatId}
                        />
                      ),
                    )}
                    {archived.length > 0 && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={showArchived}
                          onClick={() => setShowArchived((value) => !value)}
                          className={cn(
                            'w-full justify-start gap-2 text-[13px] font-normal text-muted-foreground hover:text-foreground',
                            isWide && 'rounded-[12px]',
                          )}
                        >
                          <Archive className="size-4" aria-hidden="true" />
                          <span className="flex-1">Archived ({archived.length})</span>
                        </Button>
                        {showArchived &&
                          archived.map((chat) => (
                            <ChatListItem
                              key={chat.id}
                              chat={chat}
                              selected={chat.id === activeChatId}
                              isWide={isWide}
                            />
                          ))}
                      </>
                    )}
                  </TopicKeyboardNav>
                </div>
              )}
              {search.trim().length >= 2 && (
                <MessageSearchResults
                  query={search}
                  {...(searchChat === undefined ? {} : { chatFilter: searchChat })}
                  onNotFound={() => {}}
                />
              )}
            </>
          )}
        </nav>
      </div>
      <NewChatButton onExplore={() => navigate('/explore')} />
      {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}
      {newTopicChatId !== undefined && (
        <NewTopicDialog groupId={newTopicChatId} onClose={() => setNewTopicChatId(undefined)} />
      )}
      {confirmingSignOut && (
        <ConfirmDialog
          title="Sign out of Zilar in this browser?"
          body="You'll need to sign in again to chat."
          confirmLabel="Sign out"
          onConfirm={() => {
            setConfirmingSignOut(false);
            void storeApi.getState().signOut();
          }}
          onCancel={() => setConfirmingSignOut(false)}
        />
      )}
    </div>
  );
}
