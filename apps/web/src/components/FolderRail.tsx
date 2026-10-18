import type { KeyboardEvent } from 'react';
import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { LayoutGrid, Pencil } from 'lucide-react';
import { folderIconComponent } from './folderIcon';
import { folderUnreadTotal } from '@zilar/chat-core';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

export function FolderRail() {
  const folders = useChatSelector((s) => s.folders);
  const chats = useChatSelector((s) => s.chats);
  const activeFolder = useChatSelector((s) => s.activeFolder);
  const setActiveFolder = useChatSelector((s) => s.setActiveFolder);
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
      unread: folderUnreadTotal('all', chats),
      onSelect: () => setActiveFolder('all'),
    },
    ...folders.map((folder) => ({
      key: folder.id,
      id: folder.id,
      label: folder.name,
      icon: folderIconComponent(folder.icon),
      unread: folderUnreadTotal(folder, chats),
      onSelect: () => setActiveFolder(folder.id),
    })),
  ];

  const tabCount = items.length;
  const editIndex = tabCount;

  const keyActions: { onSelect: () => void; selects: boolean }[] = [
    ...items.map((item) => ({ onSelect: item.onSelect, selects: true })),
    { onSelect: () => navigate('/settings/folders'), selects: false },
  ];

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = keyActions.length - 1;
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
    const action = keyActions[next];
    if (action !== undefined) {
      if (action.selects) {
        action.onSelect();
      }
      itemRefs.current[next]?.focus();
    }
  };

  const footKeyClass =
    'flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground';

  return (
    <>
      <nav className="flex w-[76px] shrink-0 flex-col items-stretch gap-1 overflow-y-auto rounded-2xl border border-border bg-panel p-1.5">
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Chat folders"
          className="flex flex-col items-stretch gap-1"
        >
          {items.map((item, index) => {
            const active = activeFolder === item.id;
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
                  active
                    ? 'key-icon text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
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
        </div>
        <div className="mt-auto flex flex-col gap-1 pt-2">
          <button
            type="button"
            aria-label="Edit folders"
            title="Edit folders"
            ref={(element) => {
              itemRefs.current[editIndex] = element;
            }}
            onClick={() => navigate('/settings/folders')}
            onKeyDown={(event) => moveFocus(event, editIndex)}
            className={footKeyClass}
          >
            <Pencil className="h-5 w-5" aria-hidden="true" />
            <span className="max-w-full truncate">Edit</span>
          </button>
        </div>
      </nav>
    </>
  );
}
