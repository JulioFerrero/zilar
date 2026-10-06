import { useRef, useState } from 'react';
import { GripVertical, Pencil, Plus } from 'lucide-react';
import { FOLDERS_MAX, type ChatFolder, type FolderChatType } from '@zilar/chat-core';
import { ApiError, reorderChatFolders } from '@/lib/api';
import { useChatFolders } from '@/lib/useChatFolders';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { FolderEditorDialog } from '@/components/FolderEditorDialog';
import { folderIconComponent } from '@/components/folderIcon';
import { Card } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';
import { useChatStore } from '@/store/ChatStoreProvider';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

const TYPE_LABELS: Record<FolderChatType, string> = {
  dm: 'Personal chats',
  group: 'Groups',
  channel: 'Channels',
  ai: 'AIs',
};

/** Settings → Chat folders: list, reorder, create, edit and delete (T-0238). */
export function FoldersPage({ onBack }: { onBack: () => void }) {
  const store = useChatStore();
  const storeApi = useChatStoreApi();
  // ChatShell also mounts this when the page opens from inside the app, but
  // a direct load (refresh, typed URL) needs the sync here too; mounting
  // the hook twice is safe.
  useChatFolders();
  const [dragId, setDragId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [editor, setEditor] = useState<{ open: boolean; folder: ChatFolder | null }>({
    open: false,
    folder: null,
  });

  const folders = store.folders;
  const atLimit = folders.length >= FOLDERS_MAX;
  const reorderSeq = useRef(0);
  const [reordering, setReordering] = useState(false);

  const move = (fromId: string, toId: string): void => {
    if (reordering || fromId === toId) {
      return;
    }
    const ids = folders.map((folder) => folder.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from === -1 || to === -1) {
      return;
    }
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) {
      return;
    }
    next.splice(to, 0, moved);
    void persist(next);
  };

  const moveByKey = (id: string, direction: -1 | 1): void => {
    if (reordering) {
      return;
    }
    const ids = folders.map((folder) => folder.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ids.length) {
      return;
    }
    const next = [...ids];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) {
      return;
    }
    next.splice(target, 0, moved);
    void persist(next);
  };

  const persist = async (ids: string[]): Promise<void> => {
    const previous = folders;
    const sequence = reorderSeq.current + 1;
    reorderSeq.current = sequence;
    setReordering(true);
    setError(undefined);
    try {
      const ordered = await reorderChatFolders(ids);
      if (reorderSeq.current === sequence) {
        storeApi.getState().setFolders(ordered);
      }
    } catch (reorderError) {
      if (reorderSeq.current === sequence) {
        storeApi.getState().setFolders(previous);
        setError(reorderMessage(reorderError));
      }
    } finally {
      if (reorderSeq.current === sequence) {
        setReordering(false);
      }
    }
  };

  return (
    <SettingsShell
      title="Chat folders"
      subtitle="Group chats into folders. They show in the left rail and above the chat list."
      onBack={onBack}
    >
      <div className={SETTINGS_COLUMN}>
        {folders.length === 0 ? (
          <StateMessage kind="empty" title="No folders yet. Create one to group your chats." />
        ) : (
          <Card>
            <ul className="divide-y divide-divider">
              {folders.map((folder) => {
                const Icon = folderIconComponent(folder.icon);
                return (
                  <li
                    key={folder.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', folder.id);
                      setDragId(folder.id);
                    }}
                    onDragEnd={() => setDragId(undefined)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = event.dataTransfer.getData('text/plain') || dragId;
                      setDragId(undefined);
                      if (from !== undefined && from !== '') {
                        move(from, folder.id);
                      }
                    }}
                    className={cn(
                      'flex items-center gap-2 px-2 py-2.5',
                      dragId === folder.id && 'opacity-50',
                    )}
                  >
                    <button
                      type="button"
                      aria-label={`Reorder ${folder.name}`}
                      title={`Reorder ${folder.name}`}
                      disabled={reordering}
                      onKeyDown={(event) => {
                        if (!event.altKey) {
                          return;
                        }
                        if (event.key === 'ArrowUp') {
                          event.preventDefault();
                          moveByKey(folder.id, -1);
                        } else if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          moveByKey(folder.id, 1);
                        }
                      }}
                      className="flex shrink-0 cursor-grab items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:bg-list-hover hover:text-foreground"
                    >
                      <GripVertical className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <span className="key-icon flex shrink-0 items-center justify-center rounded-xl p-2">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{folder.name}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {summary(folder)}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Edit ${folder.name}`}
                      title={`Edit ${folder.name}`}
                      onClick={() => setEditor({ open: true, folder })}
                      className="flex shrink-0 items-center justify-center rounded-full p-2 text-muted-foreground hover:bg-list-hover hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        {!atLimit && (
          <button
            type="button"
            onClick={() => setEditor({ open: true, folder: null })}
            className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-[15px] font-medium text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create new folder
          </button>
        )}
        {atLimit && (
          <p className="text-[14px] text-muted-foreground">You can have up to 20 folders.</p>
        )}
        {error !== undefined && (
          <p role="alert" className="text-[14px] text-danger">
            {error}
          </p>
        )}
        {editor.open && (
          <FolderEditorDialog
            folder={editor.folder}
            onClose={() => setEditor({ open: false, folder: null })}
          />
        )}
      </div>
    </SettingsShell>
  );
}

function summary(folder: ChatFolder): string {
  const typePart = folder.includeTypes.map((type) => TYPE_LABELS[type]).join(', ');
  const count = folder.includeChats.length;
  if (typePart === '' && count === 0) {
    return 'No rules yet';
  }
  if (count === 0) {
    return typePart;
  }
  const chatPart = count === 1 ? '1 chat' : `${count} chats`;
  if (typePart === '') {
    return chatPart;
  }
  return `${typePart}, ${chatPart}`;
}

function reorderMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'rate_limited') {
    return 'Too many changes. Wait a moment.';
  }
  return 'Could not reorder folders. Try again.';
}
