import type { ChatSummary } from '@zilar/chat-core';
import { ArrowLeft, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useMessageSearch, type MessageSearchState } from '@/lib/useMessageSearch';
import { useOpenHit } from './MessageSearchResults';
import { IconButton } from './ui/icon-button';
import { Well } from './ui/well';

/** The count chip: "n of N" once the query has hits, its length, or nothing. */
function counterLabel(search: MessageSearchState, count: number, position: number): string {
  if (search.status === 'loading') {
    return '…';
  }
  if (search.status !== 'ready') {
    return '';
  }
  return count === 0 ? '0' : `${position} of ${count}`;
}

/**
 * Search inside one chat on a narrow screen (WUX-34, T-1301): it replaces the
 * chat header with a back arrow, the query box and a match count, so searching
 * never leaves the chat. It runs the same chat-scoped search the wide layout's
 * list uses (`useMessageSearch(query, chat.id)`, as in `MessageSearchResults`)
 * and jumps with the same path (`useOpenHit`): it lands on the newest hit as
 * results arrive and on each ↑/↓ hit, calling `openAtMessage` (which pages the
 * hit in when it is not loaded) then `scrollToMessage` on the next frame.
 */
export function ChatSearchBar({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const [query, setQuery] = useState('');
  // The hit the reader stepped to for a given query; `null` means the arrival
  // default (the newest hit). Keyed by query so a new query starts fresh.
  const [selection, setSelection] = useState<{ query: string; index: number } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const search = useMessageSearch(query, chat.id);
  const items = search.status === 'ready' ? search.items : [];
  const openHit = useOpenHit(() => setNotFound(true), 'replace');

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Esc closes the bar and stays in the chat. The listener is on the capture
  // phase so it runs before the shell's narrow Esc-to-home listener
  // (ChatShell); it only acts when the key came from inside the bar, so an
  // open panel's own Esc still works.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        event.key !== 'Escape' ||
        barRef.current === null ||
        !(target instanceof Node) ||
        !barRef.current.contains(target)
      ) {
        return;
      }
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // Land on the newest hit as soon as a query's results arrive, like pressing
  // Enter in the wide layout's search box; once per query text. A new query
  // clears the mark (its status drops to `loading` first), so retyping the
  // same text jumps again.
  const jumpedQuery = useRef<string | null>(null);
  useEffect(() => {
    if (search.status !== 'ready') {
      jumpedQuery.current = null;
      return;
    }
    if (search.items.length === 0 || jumpedQuery.current === query) {
      return;
    }
    jumpedQuery.current = query;
    const first = search.items[0];
    if (first !== undefined) {
      openHit(first);
    }
  }, [search, query, openHit]);

  const count = items.length;
  const hitIndex =
    count === 0
      ? -1
      : selection !== null && selection.query === query
        ? Math.min(selection.index, count - 1)
        : 0;
  const position = hitIndex + 1;

  const step = (delta: 1 | -1): void => {
    if (count === 0) {
      return;
    }
    const next = Math.min(Math.max(Math.max(hitIndex, 0) + delta, 0), count - 1);
    const item = items[next];
    if (item === undefined) {
      return;
    }
    setSelection({ query, index: next });
    setNotFound(false);
    openHit(item);
  };

  return (
    <header
      ref={barRef}
      className="relative flex h-16 shrink-0 items-center gap-1.5 border-b border-divider bg-panel/85 px-3"
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'Enter') {
          event.preventDefault();
          step(1);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          step(-1);
        }
      }}
    >
      <IconButton aria-label="Close search" onClick={onClose}>
        <ArrowLeft className="size-5" aria-hidden="true" />
      </IconButton>
      <Well className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2.5">
        <Search className="size-[15px] shrink-0 text-subtle-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setNotFound(false);
          }}
          placeholder={`Search in ${chat.title}`}
          aria-label={`Search in ${chat.title}`}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-subtle-foreground"
        />
      </Well>
      <span
        role="status"
        aria-live="polite"
        className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground"
      >
        {counterLabel(search, count, position)}
      </span>
      <IconButton aria-label="Previous match" disabled={count === 0} onClick={() => step(-1)}>
        <ChevronUp className="size-5" aria-hidden="true" />
      </IconButton>
      <IconButton aria-label="Next match" disabled={count === 0} onClick={() => step(1)}>
        <ChevronDown className="size-5" aria-hidden="true" />
      </IconButton>
      {notFound && (
        <p
          role="alert"
          className="absolute top-full left-3 z-30 mt-1 rounded-xl border border-danger/40 bg-popover px-3 py-2 text-[12px] text-danger shadow-lg"
        >
          Message not found
        </p>
      )}
    </header>
  );
}
