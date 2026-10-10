import { Effect } from 'effect';
import { useCallback, useMemo, useState } from 'react';
import { ChatListBody } from './chatList/ChatListBody';
import { ChatListMenu } from './chatList/ChatListMenu';
import {
  APPROVAL_BADGE_CAP,
  CONNECTION_BANNER_DELAY_MS,
  createRowsSelector,
  InstallFailed,
  statusLabel,
} from './chatList/rowsSelector';
import { ExplorePage } from './ExplorePage';
import { FolderTabs } from './FolderTabs';
import { InviteDialog } from './InviteDialog';
import { NewChatButton } from './NewChatButton';
import { NewTopicDialog } from './NewTopicDialog';
import { SearchBar } from './SearchBar';
import { useDelayed } from '@/lib/useDelayed';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { usePendingApprovalCount } from '@/lib/usePendingApprovalCount';
import { useContactRequestCount } from '@/lib/useContactRequestCount';
import { useInstallPrompt } from '@/lib/push';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { useIsServerOwner } from '@/lib/useIsServerOwner';
import {
  readArchivedOpen,
  readCollapsedGroups,
  toggleArchivedOpen,
  toggleCollapsedGroup,
} from '@/lib/topicsUi';

export function ChatList({ activeChatId }: { activeChatId: string | undefined }) {
  const storeApi = useChatStoreApi();
  const selectRows = useMemo(() => createRowsSelector(), []);
  const rows = useChatSelector(selectRows);
  const storeChatCount = useChatSelector((s) => s.chats.length);
  const storeStatus = useChatSelector((s) => s.status);
  const chatsState = useChatSelector((s) => s.chatsState);
  const search = useChatSelector((s) => s.search);
  const searchChat = useChatSelector((s) => s.searchChat);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // T-0164: the Explore overlay (public groups and channels to join).
  const [exploreOpen, setExploreOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [newTopicGroup, setNewTopicGroup] = useState<string | undefined>(undefined);
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
  // A retry keeps the list that is already painted: the store's `loading` flag
  // means "pending" there, not "nothing to show". Only a list that has never
  // arrived is blanked with skeletons.
  const hasAnyChats = storeChatCount > 0;
  // Set on a manual retry so the button can show a pending state. A keep-alive
  // refresh never sets it, so background loading does not disable the button.
  const [retryingChats, setRetryingChats] = useState(false);
  // Reset during render (not in an effect) when the retry settles, so a later
  // background `loading` with rows cannot leave the button stuck pending.
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
    void storeApi.getState().signOut();
  };

  // The badge fetches only when the menu opens; `null` is "unknown or failed",
  // which the UI treats as "show nothing". A failed call leaves the previous
  // count in place.
  // The Integrations menu entry is owner-only (T-0162): the hook starts
  // as not-owner and switches on after the 200, so a non-owner never sees
  // it, even for a flash.
  const isServerOwner = useIsServerOwner();
  const pendingApprovals = usePendingApprovalCount(menuOpen);
  // T-0163: the incoming contact-request count badge, refetched on focus
  // and every 60 seconds by the hook (no realtime channel in this task).
  const incomingRequests = useContactRequestCount(true);
  // Installable app (T-0119): the browser offers `beforeinstallprompt` when
  // Zilar is installable; the menu then carries an Install entry.
  const { installEvent, promptInstall } = useInstallPrompt();
  // The prompt is started by the click itself (it needs the click's user
  // activation), so the action only waits for the promise the click created.
  const [installState, runInstall] = useAction<Promise<void>, void, InstallFailed>((prompt) =>
    Effect.tryPromise({ try: () => prompt, catch: () => new InstallFailed() }),
  );
  // The retry label shows after a failed prompt, and hides while a new prompt runs.
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
      onExplore={() => setExploreOpen(true)}
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
      {connection !== undefined && (
        <div className="shrink-0 border-b border-border px-3 py-1 text-center text-[12px] text-muted-foreground">
          {connection}
        </div>
      )}
      {!isWide && <FolderTabs />}
      <ChatListBody
        rows={rows}
        chatsState={chatsState}
        hasAnyChats={hasAnyChats}
        retrying={retrying}
        retryChats={retryChats}
        search={search}
        searchChat={searchChat}
        activeChatId={activeChatId}
        isWide={isWide}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        archivedOpen={archivedOpen}
        onToggleArchived={toggleArchived}
        showArchived={showArchived}
        onToggleShowArchived={() => setShowArchived((value) => !value)}
        onInvite={() => setInviteOpen(true)}
        onExplore={() => setExploreOpen(true)}
        onOpenNewTopic={setNewTopicGroup}
      />
      <NewChatButton onExplore={() => setExploreOpen(true)} />
      {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}
      {exploreOpen && <ExplorePage onClose={() => setExploreOpen(false)} />}
      {newTopicGroup !== undefined && (
        <NewTopicDialog groupId={newTopicGroup} onClose={() => setNewTopicGroup(undefined)} />
      )}
    </div>
  );
}
