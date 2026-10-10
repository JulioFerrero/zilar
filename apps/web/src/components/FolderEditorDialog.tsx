import { Effect } from 'effect';
import { useState } from 'react';
import {
  FOLDER_NAME_MAX,
  type ChatFolder,
  type FolderChatType,
  type FolderIcon,
} from '@zilar/chat-core';
import { createChatFolder, deleteChatFolder, patchChatFolder, type ApiChatFolder } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { type ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { ChatPicker } from './folder/ChatPicker';
import { FolderHideSection } from './folder/FolderHideSection';
import { FolderIconPicker } from './folder/FolderIconPicker';
import {
  FolderDeleteFailed,
  SECTION_LABEL,
  TYPE_SWITCHES,
  saveErrorMessage,
  type FolderWrite,
} from './folder/folderEditorModel';

/**
 * Create/edit dialog for one chat folder (T-0238): name and icon, which
 * chats to show, what to hide, and (in edit mode) a separate delete flow.
 * After every successful write it calls `setFolders` so the rail and the
 * chips above the chat list update without a reload.
 */
export function FolderEditorDialog({
  folder,
  onClose,
}: {
  /** Null for create mode, the folder for edit mode. */
  folder: ApiChatFolder | null;
  onClose: () => void;
}) {
  const chats = useChatSelector((s) => s.chats);
  const folders = useChatSelector((s) => s.folders);
  const setFolders = useChatSelector((s) => s.setFolders);

  const [name, setName] = useState(folder?.name ?? '');
  const [icon, setIcon] = useState<FolderIcon>(folder?.icon ?? 'folder');
  const [includeTypes, setIncludeTypes] = useState<FolderChatType[]>(folder?.includeTypes ?? []);
  const [includeChats, setIncludeChats] = useState<string[]>(folder?.includeChats ?? []);
  const [excludeChats, setExcludeChats] = useState<string[]>(folder?.excludeChats ?? []);
  const [excludeMuted, setExcludeMuted] = useState(folder?.excludeMuted ?? false);
  const [excludeRead, setExcludeRead] = useState(folder?.excludeRead ?? false);
  const [includeSearch, setIncludeSearch] = useState('');
  const [excludeSearch, setExcludeSearch] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const trimmed = name.trim();
  const somethingIncluded = includeTypes.length > 0 || includeChats.length > 0;
  const canSave = trimmed.length >= 1 && trimmed.length <= FOLDER_NAME_MAX && somethingIncluded;

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  const saveFolder = (): Effect.Effect<void, ApiFailure> =>
    Effect.gen(function* () {
      const body = {
        name: trimmed,
        icon,
        includeTypes,
        includeChats,
        excludeChats,
        excludeMuted,
        excludeRead,
      };
      if (folder === null) {
        const created = yield* fromApi(() => createChatFolder(body));
        setFolders([...folders, created as ChatFolder]);
      } else {
        const updated = yield* fromApi(() => patchChatFolder(folder.id, body));
        setFolders(folders.map((item) => (item.id === folder.id ? (updated as ChatFolder) : item)));
      }
      onClose();
    });

  const deleteFolder = (id: string): Effect.Effect<void, FolderDeleteFailed> =>
    Effect.gen(function* () {
      yield* fromApi(() => deleteChatFolder(id)).pipe(
        Effect.tapError(() => Effect.sync(() => setConfirmingDelete(false))),
        Effect.mapError(() => new FolderDeleteFailed()),
      );
      setFolders(folders.filter((item) => item.id !== id));
      onClose();
    });

  // A second click while a write waits is dropped (mode 'ignore'), and so is a
  // save during a delete: one state holds both, as the shared busy flag did.
  const [writeState, runWrite] = useAction(
    (request: FolderWrite): Effect.Effect<void, ApiFailure | FolderDeleteFailed> =>
      request === 'save' ? saveFolder() : folder === null ? Effect.void : deleteFolder(folder.id),
  );
  const busy = isWaiting(writeState);
  const writeFailure = busy ? undefined : failureOf(writeState);

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={folder === null ? 'New folder' : 'Edit folder'}
        ariaLabel={folder === null ? 'New folder' : `Edit folder ${folder.name}`}
        size="lg"
        actions={
          <>
            {folder !== null && (
              <Button
                type="button"
                variant="destructive"
                size="lg"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete folder
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="ghost" size="lg" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="default"
                size="lg"
                disabled={!canSave || busy}
                onClick={() => {
                  if (canSave) {
                    runWrite('save');
                  }
                }}
              >
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </>
        }
      >
        <FolderIconPicker name={name} setName={setName} icon={icon} setIcon={setIcon} />

        <section aria-label="Show these chats" className="mt-5">
          <h3 className={SECTION_LABEL}>Show these chats</h3>
          <div className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
            {TYPE_SWITCHES.map(({ type, label }) => {
              const checked = includeTypes.includes(type);
              return (
                <div key={type} className="flex items-center gap-2 px-3 py-2 text-[15px]">
                  <span className="min-w-0 flex-1">{label}</span>
                  <Switch
                    checked={checked}
                    label={label}
                    hideLabel
                    onCheckedChange={() =>
                      setIncludeTypes((types) =>
                        types.includes(type)
                          ? types.filter((item) => item !== type)
                          : [...types, type],
                      )
                    }
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 rounded-xl border border-border bg-surface px-3 py-2.5">
            <ChatPicker
              id="include"
              label="Add chats"
              picked={includeChats}
              chats={chats}
              search={includeSearch}
              onSearch={setIncludeSearch}
              onToggle={(id) => setIncludeChats((list) => toggle(list, id))}
            />
          </div>
        </section>

        <FolderHideSection
          excludeMuted={excludeMuted}
          setExcludeMuted={setExcludeMuted}
          excludeRead={excludeRead}
          setExcludeRead={setExcludeRead}
          excludeChats={excludeChats}
          setExcludeChats={setExcludeChats}
          excludeSearch={excludeSearch}
          setExcludeSearch={setExcludeSearch}
          toggle={toggle}
          chats={chats}
        />

        {writeFailure !== undefined && (
          <p role="alert" className="mt-4 text-[14px] text-danger">
            {writeFailure._tag === 'FolderDeleteFailed'
              ? 'Could not delete the folder. Try again.'
              : saveErrorMessage(writeFailure)}
          </p>
        )}
      </Dialog>
      {confirmingDelete && folder !== null && (
        <ConfirmDialog
          title="Delete folder"
          body={`Delete the folder ${folder.name}? Chats stay where they are.`}
          confirmLabel="Delete"
          onConfirm={() => runWrite('delete')}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  );
}
