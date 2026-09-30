import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { SearchItem } from '@/lib/api';
import { useMessageSearch } from '@/lib/useMessageSearch';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';
import { scrollToMessage } from '@/lib/scrollToMessage';
import { Avatar } from './Avatar';
import { MessageSearchResult } from './MessageSearchResult';

// The Messages section of the chat list: hits grouped by chat, newest group
// first. Enter opens the top hit; a click opens that hit at its message.
export function MessageSearchResults({
  query,
  chatFilter,
  onNotFound,
}: {
  query: string;
  chatFilter?: string;
  onNotFound: (chatJid: string) => void;
}) {
  const store = useChatStore();
  const storeApi = useChatStoreApi();
  const navigate = useNavigate();
  const search = useMessageSearch(query, chatFilter);
  const [jumpError, setJumpError] = useState<string | null>(null);

  const openHit = useCallback(
    (item: SearchItem): void => {
      setJumpError(null);
      void storeApi
        .getState()
        .openAtMessage(item.chatJid, item.messageId)
        .then(
          () => {
            navigate(`/c/${encodeURIComponent(item.chatJid)}`);
            scrollToMessage(item.messageId);
          },
          () => {
            setJumpError(item.chatJid);
            onNotFound(item.chatJid);
          },
        );
    },
    [storeApi, navigate, onNotFound],
  );

  // The search input lives in `SearchBar`, outside this subtree, so Enter
  // there arrives as a window event. The ref mirrors the current top hit
  // (or undefined while loading); it is only read inside the listener and
  // written from an effect, never touched during render.
  const topHitRef = useRef<SearchItem | undefined>(undefined);

  const topHit = search.status === 'ready' ? search.items[0] : undefined;
  useEffect(() => {
    topHitRef.current = topHit;
  }, [topHit]);

  useEffect(() => {
    const onSearchEnter = (): void => {
      const top = topHitRef.current;
      if (top !== undefined) {
        openHit(top);
      }
    };
    window.addEventListener('galena:search-enter', onSearchEnter);
    return () => window.removeEventListener('galena:search-enter', onSearchEnter);
  }, [openHit]);

  if (search.status === 'idle' || search.status === 'unavailable') {
    return null;
  }
  if (search.status === 'loading') {
    return (
      <div aria-label="Searching messages" className="flex flex-col gap-0.5 px-2">
        <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">Messages</p>
        <p className="px-[10px] pb-2 text-[13px] text-muted-foreground">Searching…</p>
      </div>
    );
  }
  if (search.status === 'error') {
    return (
      <div className="flex flex-col gap-0.5 px-2">
        <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">Messages</p>
        <p className="px-[10px] pb-2 text-[13px] text-muted-foreground">
          {"Couldn't search messages"}
        </p>
      </div>
    );
  }
  if (search.items.length === 0) {
    return (
      <div className="flex flex-col gap-0.5 px-2">
        <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">Messages</p>
        <p className="px-[10px] pb-2 text-[13px] text-muted-foreground">No messages found</p>
      </div>
    );
  }

  const groups = groupByChat(
    search.items,
    store.chats.map((chat) => ({ id: chat.id, title: chat.title })),
  );

  // Enter on this list opens the top hit (Enter in the search input takes
  // the window-event path above, which reads the same ref).
  const openTopFromList = (): void => {
    const top = topHitRef.current;
    if (top !== undefined) {
      openHit(top);
    }
  };

  return (
    <div
      className="flex flex-col gap-0.5 px-2"
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          openTopFromList();
        }
      }}
    >
      <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">Messages</p>
      {groups.map((group) => (
        <div key={group.chatJid}>
          <div className="flex items-center gap-2 px-[10px] pt-1.5 pb-0.5">
            <Avatar id={group.chatJid} name={group.title} size={20} />
            <span className="truncate text-[12px] font-medium text-muted-foreground">
              {group.title}
            </span>
          </div>
          {group.items.map((item) => (
            <MessageSearchResult
              key={`${item.chatJid}:${item.messageId}`}
              item={item}
              chatTitle={group.title}
              selected={false}
              onOpen={() => openHit(item)}
            />
          ))}
        </div>
      ))}
      {jumpError !== null && (
        <p role="alert" className="px-[10px] pb-2 text-[13px] text-muted-foreground">
          Message not found
        </p>
      )}
    </div>
  );
}

export function groupByChat(
  items: SearchItem[],
  chats: Array<{ id: string; title: string }>,
): Array<{ chatJid: string; title: string; items: SearchItem[] }> {
  const titles = new Map(chats.map((chat) => [chat.id, chat.title]));
  const order: string[] = [];
  const byChat = new Map<string, SearchItem[]>();
  for (const item of items) {
    const list = byChat.get(item.chatJid);
    if (list === undefined) {
      byChat.set(item.chatJid, [item]);
      order.push(item.chatJid);
    } else {
      list.push(item);
    }
  }
  return order.map((chatJid) => ({
    chatJid,
    title: titles.get(chatJid) ?? chatJid,
    items: byChat.get(chatJid) ?? [],
  }));
}
