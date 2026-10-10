import type { KeyboardEvent } from 'react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bot, LayoutGrid, Pencil, Plus, UserRound } from 'lucide-react';
import { folderIconComponent } from './folderIcon';
import { FolderEditorDialog } from './FolderEditorDialog';
import { FOLDERS_MAX } from '@zilar/chat-core';
import { folderUnreadTotal } from '@zilar/chat-core';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

/** Folder rail for wide screens: All chats, every folder, then My AIs and Profile keys. */
export function FolderRail() {
  const folders = useChatSelector((s) => s.folders);
  const chats = useChatSelector((s) => s.chats);
  const activeFolder = useChatSelector((s) => s.activeFolder);
  const setActiveFolder = useChatSelector((s) => s.setActiveFolder);
  const navigate = useNavigate();
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);

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

  // Arrow keys walk every key in the rail: the tablist items (All + folders),
  // then New (when shown), Edit, My AIs and Profile. Moving onto a folder
  // tab selects it (selection follows focus); moving onto an action key only
  // moves focus, Enter/Space activates it.
  const tabCount = items.length;
  const showNew = folders.length < FOLDERS_MAX;
  const editIndex = tabCount + (showNew ? 1 : 0);

  const keyActions: { onSelect: () => void; selects: boolean }[] = [
    ...items.map((item) => ({ onSelect: item.onSelect, selects: true })),
    ...(showNew ? [{ onSelect: () => setEditorOpen(true), selects: false }] : []),
    { onSelect: () => navigate('/settings/folders'), selects: false },
    { onSelect: () => navigate('/settings/ais'), selects: false },
    { onSelect: () => navigate('/settings/profile'), selects: false },
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
          {showNew && (
            <button
              type="button"
              aria-label="New folder"
              title="New folder"
              ref={(element) => {
                itemRefs.current[items.length] = element;
              }}
              onClick={() => setEditorOpen(true)}
              onKeyDown={(event) => moveFocus(event, items.length)}
              className={footKeyClass}
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
              <span className="max-w-full truncate">New</span>
            </button>
          )}
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
          <button
            ref={(element) => {
              itemRefs.current[editIndex + 1] = element;
            }}
            type="button"
            aria-label="My AIs"
            onClick={() => navigate('/settings/ais')}
            onKeyDown={(event) => moveFocus(event, editIndex + 1)}
            className={footKeyClass}
          >
            <Bot className="h-5 w-5" aria-hidden="true" />
            <span className="max-w-full truncate">My AIs</span>
          </button>
          <button
            ref={(element) => {
              itemRefs.current[editIndex + 2] = element;
            }}
            type="button"
            aria-label="Profile"
            onClick={() => navigate('/settings/profile')}
            onKeyDown={(event) => moveFocus(event, editIndex + 2)}
            className={footKeyClass}
          >
            <UserRound className="h-5 w-5" aria-hidden="true" />
            <span className="max-w-full truncate">Profile</span>
          </button>
        </div>
      </nav>
      {editorOpen && <FolderEditorDialog folder={null} onClose={() => setEditorOpen(false)} />}
    </>
  );
}
