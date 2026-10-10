import { Search } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Chip } from './ui/chip';
import { Well } from './ui/well';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

export function SearchBar() {
  const chats = useChatSelector((s) => s.chats);
  const searchChat = useChatSelector((s) => s.searchChat);
  const search = useChatSelector((s) => s.search);
  const setSearch = useChatSelector((s) => s.setSearch);
  const storeApi = useChatStoreApi();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // "Search only in this chat" from a chat header focuses this box; the
  // scope chip below says which chat is being searched.
  useEffect(() => {
    const onFocusSearch = (): void => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('zilar:focus-search', onFocusSearch);
    return () => window.removeEventListener('zilar:focus-search', onFocusSearch);
  }, []);

  const scopedChat =
    searchChat === undefined ? undefined : chats.find((chat) => chat.id === searchChat);
  const clearScope = (): void => {
    storeApi.getState().setSearchChat(undefined);
  };

  return (
    <Well className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2.5">
      <Search className="size-[15px] shrink-0 text-subtle-foreground" aria-hidden="true" />
      {scopedChat !== undefined && (
        <Chip
          tone="accent"
          onClick={clearScope}
          title={`Searching only in ${scopedChat.title} — click to search everywhere`}
          ariaLabel={`Searching only in ${scopedChat.title}. Activate to search all chats.`}
          className="max-w-[120px] shrink-0 truncate text-[11px]"
        >
          {scopedChat.title}
        </Chip>
      )}
      <input
        ref={inputRef}
        id="chat-search"
        name="chat-search"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          // Enter opens the top message hit when the Messages section has
          // one; the results list (a separate subtree) listens for this.
          if (event.key === 'Enter') {
            window.dispatchEvent(new Event('zilar:search-enter'));
          }
        }}
        placeholder={
          scopedChat === undefined ? 'Search, or type @username' : `Search in ${scopedChat.title}`
        }
        aria-label={scopedChat === undefined ? 'Search chats' : `Search in ${scopedChat.title}`}
        className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-subtle-foreground"
      />
      <kbd className="font-mono hidden shrink-0 rounded-md border border-border-strong px-1.5 py-px text-[11px] leading-4 text-subtle-foreground wide:inline-block">
        ⌘K
      </kbd>
    </Well>
  );
}
