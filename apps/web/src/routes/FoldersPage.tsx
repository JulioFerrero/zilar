import { Effect } from 'effect';
import { useState } from 'react';
import { GripVertical, Pencil, Plus } from 'lucide-react';
import { FOLDERS_MAX, type ChatFolder, type FolderChatType } from '@zilar/chat-core';
import { reorderChatFolders } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatFolders } from '@/lib/useChatFolders';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { FolderEditorDialog } from '@/components/FolderEditorDialog';
import { folderIconComponent } from '@/components/folderIcon';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { useChatSelector } from '@/store/ChatStoreProvider';
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
  const folders = useChatSelector((s) => s.folders);
  const storeApi = useChatStoreApi();
  // ChatShell also mounts this when the page opens from inside the app, but
  // a direct load (refresh, typed URL) needs the sync here too; mounting
  // the hook twice is safe.
  useChatFolders();
  const [dragId, setDragId] = useState<string | undefined>(undefined);
  const [editor, setEditor] = useState<{ open: boolean; folder: ChatFolder | null }>({
    open: false,
    folder: null,
  });

  const atLimit = folders.length >= FOLDERS_MAX;
  // One reorder at a time: a second one is dropped while the first waits.
  // On failure the previous order comes back; a success stores the server's order.
  const [reorderState, reorder] = useAction((ids: string[]) =>
    fromApi(() => reorderChatFolders(ids)).pipe(
      Effect.tap((ordered) => Effect.sync(() => storeApi.getState().setFolders(ordered))),
      Effect.tapError(() => Effect.sync(() => storeApi.getState().setFolders(folders))),
    ),
  );
  const reordering = isWaiting(reorderState);
  const reorderFailure = isWaiting(reorderState) ? undefined : failureOf(reorderState);
  const error = reorderFailure === undefined ? undefined : reorderMessage(reorderFailure);

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
    reorder(next);
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
    reorder(next);
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${folder.name}`}
                      title={`Edit ${folder.name}`}
                      onClick={() => setEditor({ open: true, folder })}
                      className="shrink-0 rounded-full text-muted-foreground"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
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

function reorderMessage(error: ApiFailure): string {
  if (error.code === 'rate_limited') {
    return 'Too many changes. Wait a moment.';
  }
  return 'Could not reorder folders. Try again.';
}
