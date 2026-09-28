import { Search } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Well } from './ui/well';
import { useChatStore } from '@/store/ChatStoreProvider';

export function SearchBar() {
  const store = useChatStore();
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

  return (
    <Well className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2.5">
      <Search className="size-[15px] shrink-0 text-subtle-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        id="chat-search"
        name="chat-search"
        type="search"
        value={store.search}
        onChange={(event) => store.setSearch(event.target.value)}
        placeholder="Search"
        aria-label="Search chats"
        className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-subtle-foreground"
      />
      <kbd className="font-mono hidden shrink-0 rounded-md border border-border-strong px-1.5 py-px text-[11px] leading-4 text-subtle-foreground wide:inline-block">
        ⌘K
      </kbd>
    </Well>
  );
}
