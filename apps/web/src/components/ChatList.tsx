import { Menu, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ChatListItem } from './ChatListItem';
import { EmptyState } from './EmptyState';
import { FolderTabs } from './FolderTabs';
import { InviteDialog } from './InviteDialog';
import { MessageSearchResults } from './MessageSearchResults';
import { NewChatButton } from './NewChatButton';
import { NewTopicDialog } from './NewTopicDialog';
import { SearchBar } from './SearchBar';
import { ChatListSkeleton } from './Skeleton';
import { GroupHeaderRow } from './TopicRow';
import { TopicKeyboardNav } from './TopicKeyboardNav';
import { useDelayed } from '@/lib/useDelayed';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { usePendingApprovalCount } from '@/lib/usePendingApprovalCount';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';
import { groupChats, visibleChats } from '@/store/store';
import { cn } from '@/lib/utils';
import {
  readArchivedOpen,
  readCollapsedGroups,
  toggleArchivedOpen,
  toggleCollapsedGroup,
} from '@/lib/topicsUi';

// A normal (re)connect takes well under this; only a slow one gets a banner.
const CONNECTION_BANNER_DELAY_MS = 1500;

// The menu badge caps at 9+; any number bigger than that just reads "9+".
const APPROVAL_BADGE_CAP = 9;

function statusLabel(status: string): string | undefined {
  switch (status) {
    case 'connecting':
    case 'reconnecting':
      return 'Connecting…';
    case 'offline':
      return 'Waiting for network…';
    default:
      return undefined;
  }
}

export function ChatList({ activeChatId }: { activeChatId: string | undefined }) {
  const store = useChatStore();
  const storeApi = useChatStoreApi();
  const navigate = useNavigate();
  const chats = visibleChats(store);
  const groups = groupChats(store);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [newTopicGroup, setNewTopicGroup] = useState<string | undefined>(undefined);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsedGroups());
  const [archivedOpen, setArchivedOpen] = useState<Set<string>>(() => readArchivedOpen());
  const isWide = useMediaQuery('(min-width: 900px)');
  const connection = useDelayed(statusLabel(store.status), CONNECTION_BANNER_DELAY_MS);
  // A retry keeps the list that is already painted: the store's `loading` flag
  // means "pending" there, not "nothing to show". Only a list that has never
  // arrived is blanked with skeletons.
  const hasAnyChats = store.chats.length > 0;
  // Set on a manual retry so the button can show a pending state. A keep-alive
  // refresh never sets it, so background loading does not disable the button.
  const [retryingChats, setRetryingChats] = useState(false);
  // Reset during render (not in an effect) when the retry settles, so a later
  // background `loading` with rows cannot leave the button stuck pending.
  const [lastChatsState, setLastChatsState] = useState(store.chatsState);
  if (store.chatsState !== lastChatsState) {
    setLastChatsState(store.chatsState);
    if (retryingChats && store.chatsState !== 'loading') {
      setRetryingChats(false);
    }
  }
  const retrying = retryingChats && store.chatsState === 'loading';
  const retryChats = (): void => {
    setRetryingChats(true);
    storeApi.getState().retryChats();
  };

  const signOut = (): void => {
    setMenuOpen(false);
    void store.signOut();
  };

  // The badge fetches only when the menu opens; `null` is "unknown or failed",
  // which the UI treats as "show nothing". A failed call leaves the previous
  // count in place.
  const pendingApprovals = usePendingApprovalCount(menuOpen);
  const approvalsBadge =
    pendingApprovals !== null && pendingApprovals > 0
      ? pendingApprovals > APPROVAL_BADGE_CAP
        ? '9+'
        : String(pendingApprovals)
      : null;

  const menu = (
    <div className="relative">
      <IconButton
        aria-label="Open menu"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        size={isWide ? 36 : 40}
        radius={isWide ? 10 : 12}
        onClick={() => setMenuOpen((value) => !value)}
      >
        <Menu className="size-[18px]" aria-hidden="true" />
      </IconButton>
      {menuOpen && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            aria-label="Main menu"
            className="absolute top-full right-0 z-20 mt-1 min-w-[180px] rounded-xl border border-border bg-popover py-1 shadow-lg wide:left-0 wide:right-auto"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setInviteOpen(true);
              }}
              className="flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-surface-raised"
            >
              Invite a friend
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                navigate('/settings/connections');
              }}
              className="flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-surface-raised"
            >
              Connections
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                navigate('/settings/machines');
              }}
              className="flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-surface-raised"
            >
              Machines
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                navigate('/settings/approvals');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] hover:bg-surface-raised"
            >
              <span className="flex-1">Approvals</span>
              {approvalsBadge !== null && (
                <span
                  aria-label={`${approvalsBadge} pending approvals`}
                  className="shrink-0 rounded-full bg-badge-muted px-1.5 text-[11px] font-semibold text-foreground"
                >
                  {approvalsBadge}
                </span>
              )}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                navigate('/settings/ais');
              }}
              className="flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-surface-raised"
            >
              My AIs
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center px-3 py-2 text-left text-[15px] text-danger hover:bg-surface-raised"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
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
      {connection !== undefined && (
        <div className="shrink-0 border-b border-border px-3 py-1 text-center text-[12px] text-muted-foreground">
          {connection}
        </div>
      )}
      <FolderTabs />
      <nav
        aria-label="Chats"
        className={cn(
          'scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto',
          isWide ? 'gap-0.5 px-2' : 'gap-0',
        )}
      >
        {store.chatsState === 'loading' && !hasAnyChats ? (
          <ChatListSkeleton />
        ) : store.chatsState === 'error' && !hasAnyChats ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-[15px] text-muted-foreground">{"Couldn't load chats"}</p>
            <Button type="button" size="lg" className="rounded-full px-5" onClick={retryChats}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {(store.chatsState === 'error' || retrying) && (
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
                <p className="text-[13px] text-muted-foreground">
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
            )}
            {chats.length === 0 ? (
              <EmptyState variant="no-chats" onInvite={() => setInviteOpen(true)} />
            ) : (
              <TopicKeyboardNav activeChatId={activeChatId} groups={groups}>
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
                      topics={group.topics}
                      selectedId={activeChatId}
                      collapsed={collapsed.has(group.groupId)}
                      onToggleCollapse={() =>
                        setCollapsed((current) => toggleCollapsedGroup(current, group.groupId!))
                      }
                      archivedOpen={archivedOpen.has(group.groupId)}
                      onToggleArchived={() =>
                        setArchivedOpen((current) => toggleArchivedOpen(current, group.groupId!))
                      }
                      isWide={isWide}
                      onOpenNewTopic={() => setNewTopicGroup(group.groupId)}
                    />
                  ),
                )}
              </TopicKeyboardNav>
            )}
            {/* Message hits come after the chat-name matches. `searchChat`
                scopes "Search only in this chat" from a chat header. */}
            {store.search.trim().length >= 2 && (
              <MessageSearchResults
                query={store.search}
                {...(store.searchChat === undefined ? {} : { chatFilter: store.searchChat })}
                onNotFound={() => {}}
              />
            )}
          </>
        )}
      </nav>
      <NewChatButton />
      {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}
      {newTopicGroup !== undefined && (
        <NewTopicDialog groupId={newTopicGroup} onClose={() => setNewTopicGroup(undefined)} />
      )}
    </div>
  );
}
