import type { SearchItem } from '@/lib/api';
import { formatListTime, searchResultTitle, snippetParts } from '@zilar/chat-core';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';
import { EntityAvatar } from './EntityAvatar';

// The snippet is server text plus ranges and is always rendered as text, never HTML.
export function SearchSnippet({
  snippet,
  marks,
}: {
  snippet: string;
  marks: Array<[number, number]>;
}) {
  const parts = snippetParts(snippet, marks);
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
  const chat = useChatSelector((s) => s.chats.find((entry) => entry.id === item.chatJid));
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
      <EntityAvatar
        chat={{
          id: item.chatJid,
          title: topicLabel ?? chatTitle,
          ...(chat?.avatarUrl === undefined ? {} : { avatarUrl: chat.avatarUrl }),
        }}
        size={36}
        ai={chat?.isAI === true}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[13px] leading-5 font-semibold text-foreground">
            {searchResultTitle(chatTitle, topicLabel)}
          </span>
          <span className="ml-auto shrink-0 pl-1.5 font-mono text-[11px] text-subtle-foreground">
            {formatListTime(new Date(item.at), new Date())}
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5 text-[13px] leading-5">
          <span className="shrink-0 text-foreground">{item.senderName}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            <SearchSnippet snippet={item.snippet} marks={item.marks} />
          </span>
        </div>
      </div>
    </button>
  );
}
