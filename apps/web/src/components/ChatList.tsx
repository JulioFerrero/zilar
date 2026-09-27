import { Menu } from 'lucide-react';
import { useState } from 'react';
import { ChatListItem } from './ChatListItem';
import { EmptyState } from './EmptyState';
import { FolderTabs } from './FolderTabs';
import { InviteDialog } from './InviteDialog';
import { NewChatButton } from './NewChatButton';
import { SearchBar } from './SearchBar';
import { useChatStore } from '@/store/ChatStoreProvider';
import { visibleChats } from '@/store/store';

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
  const chats = visibleChats(store);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const connection = statusLabel(store.status);

  const signOut = (): void => {
    setMenuOpen(false);
    void store.signOut();
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1.5 px-2 pt-2 pb-1.5">
        <div className="relative">
          <button
            type="button"
            aria-label="Open menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
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
                className="absolute top-full left-0 z-20 mt-1 min-w-[180px] rounded-xl border border-divider bg-popover py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setInviteOpen(true);
                  }}
                  className="flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-list-hover"
                >
                  Invite a friend
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={signOut}
                  className="flex w-full items-center px-3 py-2 text-left text-[15px] text-danger hover:bg-list-hover"
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
        <div className="shrink-0 border-b border-divider px-3 py-1 text-center text-[12px] text-muted-foreground">
          {connection}
        </div>
      )}
      <FolderTabs />
      <nav aria-label="Chats" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {chats.length === 0 ? (
          <EmptyState variant="no-chats" onInvite={() => setInviteOpen(true)} />
        ) : (
          chats.map((chat) => (
            <ChatListItem key={chat.id} chat={chat} selected={chat.id === activeChatId} />
          ))
        )}
      </nav>
      <NewChatButton />
      {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}
    </div>
  );
}
