import { Menu } from 'lucide-react';
import { ChatListItem } from './ChatListItem';
import { EmptyState } from './EmptyState';
import { FolderTabs } from './FolderTabs';
import { NewChatButton } from './NewChatButton';
import { SearchBar } from './SearchBar';
import { useChatStore } from '@/store/ChatStoreProvider';
import { visibleChats } from '@/store/store';

export function ChatList({ activeChatId }: { activeChatId: string | undefined }) {
  const store = useChatStore();
  const chats = visibleChats(store);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1.5 px-2 pt-2 pb-1.5">
        <button
          type="button"
          aria-label="Open menu"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <SearchBar />
      </div>
      <FolderTabs />
      <nav aria-label="Chats" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {chats.length === 0 ? (
          <EmptyState variant="no-chats" />
        ) : (
          chats.map((chat) => (
            <ChatListItem key={chat.id} chat={chat} selected={chat.id === activeChatId} />
          ))
        )}
      </nav>
      <NewChatButton />
    </div>
  );
}
