import { folderUnread, type FolderId } from '@/store/store';
import { useChatStore } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

const FOLDERS: { id: FolderId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'personal', label: 'Personal' },
  { id: 'ais', label: 'AIs' },
  { id: 'work', label: 'Work' },
];

export function FolderTabs() {
  const store = useChatStore();

  return (
    <div
      role="tablist"
      aria-label="Chat folders"
      className="scrollbar-thin flex shrink-0 gap-1 overflow-x-auto border-b border-divider px-2"
    >
      {FOLDERS.map((folder) => {
        const active = store.activeFolder === folder.id;
        const unread = folderUnread(store, folder.id);
        return (
          <button
            key={folder.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => store.setActiveFolder(folder.id)}
            className={cn(
              'relative shrink-0 px-3 py-2.5 text-[15px] font-medium transition-colors',
              active ? 'text-accent' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="flex items-center gap-1.5">
              {folder.label}
              {unread > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[11px] leading-4 font-semibold',
                    active ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {unread}
                </span>
              )}
            </span>
            {active && (
              <span className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-accent" />
            )}
          </button>
        );
      })}
    </div>
  );
}
