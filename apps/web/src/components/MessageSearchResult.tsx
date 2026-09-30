import type { SearchItem } from '@/lib/api';
import { formatListTime } from '@galena/chat-core';
import { useChatStore } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';
import { Avatar } from './Avatar';

// Renders one message hit with its snippet highlights. The snippet is plain
// text from the server (plus character ranges); every slice is rendered as
// text, never HTML, so a hostile snippet cannot inject markup.
export function SearchSnippet({
  snippet,
  marks,
}: {
  snippet: string;
  marks: Array<[number, number]>;
}) {
  const chars = [...snippet];
  const sorted = [...marks]
    .filter(([start, end]) => start < end && start >= 0 && end <= chars.length)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const parts: Array<{ text: string; mark: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start < cursor) {
      continue;
    }
    if (start > cursor) {
      parts.push({ text: chars.slice(cursor, start).join(''), mark: false });
    }
    parts.push({ text: chars.slice(start, end).join(''), mark: true });
    cursor = end;
  }
  if (cursor < chars.length) {
    parts.push({ text: chars.slice(cursor).join(''), mark: false });
  }
  return (
    <span className="truncate">
      {parts.map((part, index) =>
        part.mark ? (
          <span
            key={index}
            className="rounded-[3px] bg-accent/25 text-foreground"
            data-search-mark="true"
          >
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}

export function MessageSearchResult({
  item,
  chatTitle,
  topicLabel,
  selected,
  onOpen,
}: {
  item: SearchItem;
  chatTitle: string;
  topicLabel?: string;
  selected: boolean;
  onOpen: () => void;
}) {
  const store = useChatStore();
  const chat = store.chats.find((entry) => entry.id === item.chatJid);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-[12px] p-[10px] text-left transition-colors hover:bg-surface-raised',
        selected && 'bg-surface-raised',
      )}
    >
      <Avatar
        id={item.chatJid}
        name={topicLabel ?? chatTitle}
        avatarUrl={chat?.avatarUrl}
        size={36}
        ai={chat?.isAI === true}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[13px] leading-5 font-semibold text-foreground">
            {topicLabel === undefined ? chatTitle : `${chatTitle} › ${topicLabel}`}
          </span>
          <span className="ml-auto shrink-0 pl-1.5 font-mono text-[11px] text-subtle-foreground">
            {formatListTime(new Date(item.at), new Date())}
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5 text-[13px] leading-5">
          <span className="shrink-0 text-[#d4d4d4]">{item.senderName}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            <SearchSnippet snippet={item.snippet} marks={item.marks} />
          </span>
        </div>
      </div>
    </button>
  );
}
