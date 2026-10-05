import type { KeyboardEvent } from 'react';
import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { Bot, LayoutGrid, UserRound } from 'lucide-react';
import { folderIconComponent } from './folderIcon';
import { folderUnread } from '@/store/store';
import { useChatStore } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

/** Folder rail for wide screens: All chats, every folder, then My AIs and Profile keys. */
export function FolderRail() {
  const store = useChatStore();
  const navigate = useNavigate();
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const items: {
    key: string;
    id: string;
    label: string;
    icon: typeof LayoutGrid;
    unread: number;
    onSelect: () => void;
  }[] = [
    {
      key: 'all',
      id: 'all',
      label: 'All chats',
      icon: LayoutGrid,
      unread: folderUnread(store, 'all'),
      onSelect: () => store.setActiveFolder('all'),
    },
    ...store.folders.map((folder) => ({
      key: folder.id,
      id: folder.id,
      label: folder.name,
      icon: folderIconComponent(folder.icon),
      unread: folderUnread(store, folder.id),
      onSelect: () => store.setActiveFolder(folder.id),
    })),
  ];

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = items.length + 1;
    let next: number | undefined;
    if (event.key === 'ArrowDown') {
      next = index === last ? 0 : index + 1;
    } else if (event.key === 'ArrowUp') {
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
    if (next < items.length) {
      items[next]?.onSelect();
    } else if (next === items.length) {
      navigate('/settings/ais');
    } else {
      navigate('/settings/profile');
    }
    itemRefs.current[next]?.focus();
  };

  const footKeyClass =
    'flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground';

  return (
    <nav
      aria-label="Chat folders"
      className="flex w-[76px] shrink-0 flex-col items-stretch gap-1 overflow-y-auto rounded-2xl border border-border bg-panel p-1.5"
    >
      {items.map((item, index) => {
        const active = store.activeFolder === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${item.label}${item.unread > 0 ? `, ${item.unread} unread` : ''}`}
            tabIndex={active ? 0 : -1}
            onClick={item.onSelect}
            onKeyDown={(event) => moveFocus(event, index)}
            className={cn(
              'relative flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors',
              active ? 'key-icon text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="relative">
              <Icon className="h-5 w-5" aria-hidden="true" />
              {item.unread > 0 && (
                <span className="font-mono absolute -top-1.5 -right-2 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-semibold text-accent-foreground">
                  {item.unread}
                </span>
              )}
            </span>
            <span className="max-w-full truncate">{item.label}</span>
          </button>
        );
      })}
      <div className="mt-auto flex flex-col gap-1 pt-2">
        <button
          ref={(element) => {
            itemRefs.current[items.length] = element;
          }}
          type="button"
          aria-label="My AIs"
          onClick={() => navigate('/settings/ais')}
          onKeyDown={(event) => moveFocus(event, items.length)}
          className={footKeyClass}
        >
          <Bot className="h-5 w-5" aria-hidden="true" />
          <span className="max-w-full truncate">My AIs</span>
        </button>
        <button
          ref={(element) => {
            itemRefs.current[items.length + 1] = element;
          }}
          type="button"
          aria-label="Profile"
          onClick={() => navigate('/settings/profile')}
          onKeyDown={(event) => moveFocus(event, items.length + 1)}
          className={footKeyClass}
        >
          <UserRound className="h-5 w-5" aria-hidden="true" />
          <span className="max-w-full truncate">Profile</span>
        </button>
      </div>
    </nav>
  );
}
