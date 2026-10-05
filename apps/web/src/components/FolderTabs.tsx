import type { KeyboardEvent } from 'react';
import { useRef } from 'react';
import { LayoutGrid } from 'lucide-react';
import { folderIconComponent } from './folderIcon';
import { folderUnread } from '@/store/store';
import { useChatStore } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

/** Folder chips for narrow screens: "All chats" plus one chip per folder. */
export function FolderTabs() {
  const store = useChatStore();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const tabs: { id: string; label: string; icon: typeof LayoutGrid | null; unread: number }[] = [
    { id: 'all', label: 'All chats', icon: null, unread: folderUnread(store, 'all') },
    ...store.folders.map((folder) => ({
      id: folder.id,
      label: folder.name,
      icon: folderIconComponent(folder.icon),
      unread: folderUnread(store, folder.id),
    })),
  ];

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = tabs.length - 1;
    let next: number | undefined;
    if (event.key === 'ArrowRight') {
      next = index === last ? 0 : index + 1;
    } else if (event.key === 'ArrowLeft') {
      next = index === 0 ? last : index - 1;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = last;
    }
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    const tab = tabs[next];
    if (tab === undefined) {
      return;
    }
    store.setActiveFolder(tab.id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Chat folders"
      className="scrollbar-thin flex shrink-0 gap-1.5 overflow-x-auto px-3 pt-1 pb-2"
    >
      {tabs.map((tab, index) => {
        const active = store.activeFolder === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => store.setActiveFolder(tab.id)}
            onKeyDown={(event) => moveFocus(event, index)}
            className={cn(
              'flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
              active
                ? 'segment-raised border-edge text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon !== null && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            {tab.label}
            {tab.unread > 0 && (
              <span
                className={cn(
                  'font-mono rounded-full px-1 text-[10px] leading-4 font-semibold',
                  active ? 'bg-accent text-accent-foreground' : 'bg-surface text-muted-foreground',
                )}
              >
                {tab.unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
