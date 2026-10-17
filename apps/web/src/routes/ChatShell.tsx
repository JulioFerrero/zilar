import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { safeDecode } from '@zilar/chat-core';
import { ChatList } from '@/components/ChatList';
import { EmptyState } from '@/components/EmptyState';
import { FolderRail } from '@/components/FolderRail';
import { ChatView } from './ChatView';
import { useChatSelector } from '@/store/ChatStoreProvider';
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
  const chat = useChatSelector((s) =>
    chatId === undefined ? undefined : s.chats.find((item) => item.id === chatId),
  );
  const navigate = useNavigate();
  const isWide = useMediaQuery('(min-width: 900px)');
  // WUX-33: on a wide layout Esc closes the open chat too. Dialogs and menus
  // swallow their own Escape before window listeners, but the search box does
  // not, so skip while a search (text or a scoped chat) is open: the first
  // Escape clears it, the next closes the chat.
  const searchOpen = useChatSelector((s) => s.search.trim() !== '' || s.searchChat !== undefined);
  useChatFolders();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || chatId === undefined) {
        return;
      }
      // An Escape a dialog, menu or the composer already handled never closes
      // the chat too.
      if (event.defaultPrevented) {
        return;
      }
      if (isWide && searchOpen) {
        return;
      }
      navigate('/');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isWide, chatId, navigate, searchOpen]);

  // T-1874: Alt+Up/Down opens the previous/next chat in the list, the way
  // Telegram desktop does, even while the composer has focus. The rows are the
  // same links TopicKeyboardNav moves through; no wrap at either end.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
      ) {
        return;
      }
      if (event.defaultPrevented) {
        return;
      }
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Chats"] a[data-topic-row]'),
      );
      const index = links.findIndex((link) => link.getAttribute('aria-current') === 'page');
      const next =
        index === -1
          ? event.key === 'ArrowDown'
            ? links[0]
            : undefined
          : links[event.key === 'ArrowDown' ? index + 1 : index - 1];
      if (next === undefined) {
        return;
      }
      event.preventDefault();
      navigate(next.getAttribute('href') ?? '/');
      next.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

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
