import { Effect, Schema } from 'effect';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChatListBody } from './chatList/ChatListBody';
import { ChatListMenu } from './chatList/ChatListMenu';
import {
  APPROVAL_BADGE_CAP,
  CONNECTION_BANNER_DELAY_MS,
  createRowsSelector,
  InstallFailed,
  statusLabel,
} from './chatList/rowsSelector';
import { ConfirmDialog } from './ConfirmDialog';
import { FolderTabs } from './FolderTabs';
import { InviteDialog } from './InviteDialog';
import { NewChatButton } from './NewChatButton';
import { NewTopicDialog } from './NewTopicDialog';
import { SearchBar } from './SearchBar';
import { useDelayed } from '@zilar/client-core';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { usePendingApprovalCount } from '@/lib/usePendingApprovalCount';
import { useContactRequestCount } from '@/lib/useContactRequestCount';
import { useInstallPrompt } from '@/lib/push';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { useIsServerOwner } from '@/lib/useIsServerOwner';

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
          onExplore={() => navigate('/explore')}
          onOpenNewTopic={setNewTopicChatId}
        />
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
