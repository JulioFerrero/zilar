import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { safeDecode } from '@zilar/chat-core';
import { ChatList } from '@/components/ChatList';
import { EmptyState } from '@/components/EmptyState';
import { FolderRail } from '@/components/FolderRail';
import { ChatView } from './ChatView';
import { useChatStore } from '@/store/ChatStoreProvider';
import { useChatFolders } from '@/lib/useChatFolders';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';

function decodeParam(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return safeDecode(value);
}

export function ChatShell() {
  const params = useParams<{ chatJid?: string }>();
  const chatId = decodeParam(params.chatJid);
  const store = useChatStore();
  const navigate = useNavigate();
  const isWide = useMediaQuery('(min-width: 900px)');
  useChatFolders();
  const chat = chatId === undefined ? undefined : store.chats.find((item) => item.id === chatId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !isWide && chatId !== undefined) {
        navigate('/');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isWide, chatId, navigate]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-page wide:gap-3 wide:p-3">
      {isWide && <FolderRail />}
      <aside
        className={cn(
          'h-full w-full min-w-0 flex-col bg-panel wide:w-[360px] wide:shrink-0 wide:overflow-hidden wide:rounded-2xl wide:border wide:border-border',
          chatId === undefined ? 'flex' : 'hidden wide:flex',
        )}
      >
        <ChatList activeChatId={chatId} />
      </aside>
      <main
        className={cn(
          'h-full min-w-0 flex-1 flex-col bg-panel wide:overflow-hidden wide:rounded-2xl wide:border wide:border-border',
          chatId === undefined ? 'hidden wide:flex' : 'flex',
        )}
      >
        {chat !== undefined ? (
          <ChatView key={chat.id} chat={chat} />
        ) : (
          <EmptyState variant="no-chat-selected" />
        )}
      </main>
    </div>
  );
}
