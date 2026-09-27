import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ChatList } from '@/components/ChatList';
import { EmptyState } from '@/components/EmptyState';
import { ChatView } from './ChatView';
import { useChatStore } from '@/store/ChatStoreProvider';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';

export function ChatShell() {
  const { chatId } = useParams();
  const store = useChatStore();
  const navigate = useNavigate();
  const isWide = useMediaQuery('(min-width: 900px)');
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
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <aside
        className={cn(
          'h-full w-full min-w-0 flex-col border-r border-divider wide:w-[360px] wide:shrink-0',
          chatId === undefined ? 'flex' : 'hidden wide:flex',
        )}
      >
        <ChatList activeChatId={chatId} />
      </aside>
      <main
        className={cn(
          'h-full min-w-0 flex-1 flex-col',
          chatId === undefined ? 'hidden wide:flex' : 'flex',
        )}
      >
        {chat !== undefined ? <ChatView chat={chat} /> : <EmptyState variant="no-chat-selected" />}
      </main>
    </div>
  );
}
