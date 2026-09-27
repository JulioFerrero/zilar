import { Search } from 'lucide-react';
import { useEffect, useRef } from 'react';
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
    <div className="relative min-w-0 flex-1">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        value={store.search}
        onChange={(event) => store.setSearch(event.target.value)}
        placeholder="Search"
        aria-label="Search chats"
        className="h-9 w-full rounded-full bg-muted pr-3 pl-9 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent"
      />
    </div>
  );
}
