import { Effect } from 'effect';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { StateMessage } from '@/components/ui/state-message';
import type { SearchItem } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';
import { useMessageSearch } from '@/lib/useMessageSearch';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { scrollToMessage } from '@/lib/scrollToMessage';
import { EntityAvatar } from './EntityAvatar';
import { MessageSearchResult } from './MessageSearchResult';

// A stable empty list: keeps `items` referentially equal between renders while
// there is no settled answer, so the memo below does not churn.
const EMPTY_ITEMS: SearchItem[] = [];

// Opens a hit at its message: the chat route, then a scroll, on the next
// frame, once the history page holding the message is loaded and any window
// growth has settled (the reply, pin and media jumps all defer their scroll
// the same way, `MessageBubble.tsx:150`). `mode` is 'replace' for the narrow
// search bar, whose single action must follow fast stepping instead of
// dropping a step while the one before is still paging. Exported so the
// narrow in-chat search bar (ChatSearchBar) jumps with the same path.
export function useOpenHit(
  onNotFound: (chatJid: string) => void,
  mode: 'ignore' | 'replace' = 'ignore',
): (item: SearchItem) => void {
  const storeApi = useChatStoreApi();
  const navigate = useNavigate();
  const [, open] = useAction(
    (item: SearchItem) =>
      fromApi(() => storeApi.getState().openAtMessage(item.chatJid, item.messageId)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            navigate(`/c/${encodeURIComponent(item.chatJid)}`);
            window.requestAnimationFrame(() => {
              scrollToMessage(item.messageId);
            });
          }),
        ),
        Effect.tapError(() => Effect.sync(() => onNotFound(item.chatJid))),
      ),
    { mode },
  );
  return open;
}

// One hit row with its own open action, so two rows can open at once.
function SearchHit({
  item,
  chatTitle,
  selected,
  onStart,
  onNotFound,
}: {
  item: SearchItem;
  chatTitle: string;
  selected: boolean;
  onStart: () => void;
  onNotFound: (chatJid: string) => void;
}) {
  const open = useOpenHit(onNotFound);
  return (
    <MessageSearchResult
      item={item}
      chatTitle={chatTitle}
      selected={selected}
      onOpen={() => {
        onStart();
        open(item);
      }}
    />
  );
}

type SearchGroup = ReturnType<typeof groupByChat>[number];

// The rendered hit list with a highlighted row (WUX-23). It is keyed by the
// query and scope in the parent, so a new search remounts it and the highlight
// starts at the first hit again. Up/Down move the highlight, Enter opens it; a
// click opens that hit at its message.
function MessageHitList({
  groups,
  notFound,
  onHitStart,
  onHitNotFound,
}: {
  groups: SearchGroup[];
  notFound: boolean;
  onHitStart: () => void;
  onHitNotFound: (chatJid: string) => void;
}) {
  const [highlighted, setHighlighted] = useState(0);
  const displayItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const indexByKey = useMemo(() => {
    const map = new Map<string, number>();
    displayItems.forEach((item, index) => {
      map.set(`${item.chatJid}:${item.messageId}`, index);
    });
    return map;
  }, [displayItems]);

  // The ref mirrors the ordered hits so the window listeners read the current
  // list without being re-subscribed on every keystroke; a layout effect keeps
  // it in step before the rows paint.
  const itemsRef = useRef<SearchItem[]>([]);
  useLayoutEffect(() => {
    itemsRef.current = displayItems;
  }, [displayItems]);

  const openHit = useOpenHit(onHitNotFound);
  const openAt = useCallback(
    (index: number): void => {
      const item = itemsRef.current[index];
      if (item !== undefined) {
        onHitStart();
        openHit(item);
      }
    },
    [onHitStart, openHit],
  );

  const move = useCallback((delta: number): void => {
    const count = itemsRef.current.length;
    if (count === 0) {
      return;
    }
    setHighlighted((current) => (((current + delta) % count) + count) % count);
  }, []);

  // The search input lives in `SearchBar`, outside this subtree, so Up/Down
  // there arrive as window events while it has focus. Enter there is the
  // existing `zilar:search-enter` path, now opening the highlighted hit
  // instead of only the top one.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement) || active.id !== 'chat-search') {
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move]);

  useEffect(() => {
    const onSearchEnter = (): void => {
      openAt(highlighted);
    };
    window.addEventListener('zilar:search-enter', onSearchEnter);
    return () => window.removeEventListener('zilar:search-enter', onSearchEnter);
  }, [openAt, highlighted]);

  return (
    <div
      className="flex flex-col gap-0.5 px-2"
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          openAt(highlighted);
        }
      }}
    >
      <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">Messages</p>
      {groups.map((group) => (
        <div key={group.chatJid}>
          <div className="flex items-center gap-2 px-[10px] pt-1.5 pb-0.5">
            <EntityAvatar
              chat={{ id: group.chatJid, title: group.title, avatarUrl: group.avatarUrl }}
              size={20}
            />
            <span className="truncate text-[12px] font-medium text-muted-foreground">
              {group.title}
            </span>
          </div>
          {group.items.map((item) => (
            <SearchHit
              key={`${item.chatJid}:${item.messageId}`}
              item={item}
              chatTitle={group.title}
              selected={indexByKey.get(`${item.chatJid}:${item.messageId}`) === highlighted}
              onStart={onHitStart}
              onNotFound={onHitNotFound}
            />
          ))}
        </div>
      ))}
      {notFound && (
        <p role="alert" className="px-[10px] pb-2 text-[13px] text-muted-foreground">
          Message not found
        </p>
      )}
    </div>
  );
}

// The Messages section of the chat list: hits grouped by chat, newest group
// first. Rendered only once a search has results; the hit list handles the
// highlight and Enter.
export function MessageSearchResults({
  query,
  chatFilter,
  onNotFound,
}: {
  query: string;
  chatFilter?: string;
  onNotFound: (chatJid: string) => void;
}) {
  const chats = useChatSelector((s) => s.chats);
  const search = useMessageSearch(query, chatFilter);
  const [notFound, setNotFound] = useState(false);

  const onHitStart = useCallback((): void => {
    setNotFound(false);
  }, []);
  const onHitNotFound = useCallback(
    (chatJid: string): void => {
      setNotFound(true);
      onNotFound(chatJid);
    },
    [onNotFound],
  );

  const items: SearchItem[] = search.status === 'ready' ? search.items : EMPTY_ITEMS;
  const groups = useMemo(
    () =>
      groupByChat(
        items,
        chats.map((chat) => ({ id: chat.id, title: chat.title, avatarUrl: chat.avatarUrl })),
      ),
    [items, chats],
  );

  if (search.status === 'idle' || search.status === 'unavailable') {
    return null;
  }
  if (search.status === 'loading') {
    return (
      <div aria-label="Searching messages" className="flex flex-col gap-0.5 px-2">
        <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">Messages</p>
        <div className="px-[10px] pb-2">
          <StateMessage kind="loading" size="inline" title="Searching…" />
        </div>
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
        <StateMessage kind="empty" size="inline" title="No messages found" />
      </div>
    );
  }

  return (
    <MessageHitList
      key={`${query}\u0000${chatFilter ?? ''}`}
      groups={groups}
      notFound={notFound}
      onHitStart={onHitStart}
      onHitNotFound={onHitNotFound}
    />
  );
}

export function groupByChat(
  items: SearchItem[],
  chats: Array<{ id: string; title: string; avatarUrl?: string | undefined }>,
): Array<{ chatJid: string; title: string; avatarUrl?: string | undefined; items: SearchItem[] }> {
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
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
  return order.map((chatJid) => {
    const chat = byId.get(chatJid);
    return {
      chatJid,
      title: chat?.title ?? chatJid,
      ...(chat?.avatarUrl === undefined ? {} : { avatarUrl: chat.avatarUrl }),
      items: byChat.get(chatJid) ?? [],
    };
  });
}
