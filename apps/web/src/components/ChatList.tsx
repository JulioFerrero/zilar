import { Menu } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ChatListItem } from './ChatListItem';
import { EmptyState } from './EmptyState';
import { FolderTabs } from './FolderTabs';
import { InviteDialog } from './InviteDialog';
import { NewChatButton } from './NewChatButton';
import { SearchBar } from './SearchBar';
import { ChatListSkeleton } from './Skeleton';
import { useDelayed } from '@/lib/useDelayed';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';
import { visibleChats } from '@/store/store';

// A normal (re)connect takes well under this; only a slow one gets a banner.
const CONNECTION_BANNER_DELAY_MS = 1500;

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const connection = useDelayed(statusLabel(store.status), CONNECTION_BANNER_DELAY_MS);

  const signOut = (): void => {
    setMenuOpen(false);
    void store.signOut();
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
        <div className="relative">
          <IconButton
            aria-label="Open menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
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
                className="absolute top-full left-0 z-20 mt-1 min-w-[180px] rounded-xl border border-border bg-popover py-1 shadow-lg"
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
        <SearchBar />
      </div>
      {connection !== undefined && (
        <div className="shrink-0 border-b border-border px-3 py-1 text-center text-[12px] text-muted-foreground">
          {connection}
        </div>
      )}
      <FolderTabs />
      <nav
        aria-label="Chats"
        className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2"
      >
        {store.chatsState === 'loading' ? (
          <ChatListSkeleton />
        ) : store.chatsState === 'error' && store.chats.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-[15px] text-muted-foreground">{"Couldn't load chats"}</p>
            <Button
              type="button"
              size="lg"
              className="rounded-full px-5"
              onClick={() => storeApi.getState().retryChats()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            {store.chatsState === 'error' && (
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
                <p className="text-[13px] text-muted-foreground">{"Couldn't load chats"}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => storeApi.getState().retryChats()}
                >
                  Retry
                </Button>
              </div>
            )}
            {chats.length === 0 ? (
              <EmptyState variant="no-chats" onInvite={() => setInviteOpen(true)} />
            ) : (
              chats.map((chat) => (
                <ChatListItem key={chat.id} chat={chat} selected={chat.id === activeChatId} />
              ))
            )}
          </>
        )}
      </nav>
      <NewChatButton />
      {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}
    </div>
  );
}
