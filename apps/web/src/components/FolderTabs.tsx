import type { KeyboardEvent } from 'react';
import { useRef } from 'react';
import { folderUnread, type FolderId } from '@/store/store';
import { useChatStore } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

const FOLDERS: { id: FolderId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'personal', label: 'Personal' },
  { id: 'ais', label: 'AIs' },
  { id: 'work', label: 'Work' },
];

/** Folder segmented control: a recessed track with a raised active segment. */
export function FolderTabs() {
  const store = useChatStore();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = FOLDERS.length - 1;
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
    const folder = FOLDERS[next];
    if (folder === undefined) {
      return;
    }
    store.setActiveFolder(folder.id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Chat folders"
      className="well-surface mx-3 mt-1 mb-2 grid shrink-0 grid-cols-4 gap-0.5 rounded-[10px] p-[3px]"
      style={{ borderColor: '#1a1a1a' }}
    >
      {FOLDERS.map((folder, index) => {
        const active = store.activeFolder === folder.id;
        const unread = folderUnread(store, folder.id);
        return (
          <button
            key={folder.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => store.setActiveFolder(folder.id)}
            onKeyDown={(event) => moveFocus(event, index)}
            className={cn(
              'flex h-[30px] items-center justify-center gap-1 rounded-[7px] text-[13px] font-medium transition-colors',
              active
                ? 'segment-raised text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {folder.label}
            {unread > 0 && (
              <span
                className={cn(
                  'font-mono rounded-full px-1 text-[10px] leading-4 font-semibold',
                  active ? 'bg-accent text-accent-foreground' : 'bg-surface text-muted-foreground',
                )}
              >
                {unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
