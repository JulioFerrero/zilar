import { ChatPicker } from './folder/ChatPicker';
import { ConfirmDialog } from './ConfirmDialog';
import {
  FolderDeleteFailed,
  SECTION_LABEL,
  TYPE_SWITCHES,
  saveErrorMessage,
  type FolderWrite,
} from './folder/folderEditorModel';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Switch } from './ui/switch';
import { folderIconComponent } from '@/components/folderIcon';
import { createChatFolder, deleteChatFolder, patchChatFolder, type ApiChatFolder } from '@/lib/api';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { cn } from '@/lib/utils';
import { useChatSelector } from '@/store/ChatStoreProvider';
import {
  FOLDER_NAME_MAX,
  type ChatFolder,
  type FolderChatType,
  type FolderIcon,
  FOLDER_ICONS,
} from '@zilar/chat-core';
import { fromApi, type ApiFailure } from '@zilar/client-core';
import { Effect } from 'effect';
import { useState, type ComponentProps, type Dispatch, type SetStateAction } from 'react';

function FolderHideSection({
  excludeMuted,
  setExcludeMuted,
  excludeRead,
  setExcludeRead,
  excludeChats,
  setExcludeChats,
  excludeSearch,
  setExcludeSearch,
  toggle,
  chats,
}: {
  excludeMuted: boolean;
  setExcludeMuted: Dispatch<SetStateAction<boolean>>;
  excludeRead: boolean;
  setExcludeRead: Dispatch<SetStateAction<boolean>>;
  excludeChats: string[];
  setExcludeChats: Dispatch<SetStateAction<string[]>>;
  excludeSearch: string;
  setExcludeSearch: Dispatch<SetStateAction<string>>;
  toggle: (list: string[], id: string) => string[];
  chats: ComponentProps<typeof ChatPicker>['chats'];
}) {
  return (
    <section aria-label="Hide" className="mt-5">
      <h3 className={SECTION_LABEL}>Hide</h3>
      <div className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-2 px-3 py-2 text-[15px]">
          <span className="min-w-0 flex-1">Muted chats</span>
          <Switch
            checked={excludeMuted}
            label="Muted chats"
            hideLabel
            onCheckedChange={() => setExcludeMuted((value) => !value)}
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-2 text-[15px]">
          <span className="min-w-0 flex-1">Read chats</span>
          <Switch
            checked={excludeRead}
            label="Read chats"
            hideLabel
            onCheckedChange={() => setExcludeRead((value) => !value)}
          />
        </div>
      </div>
      <div className="mt-2 rounded-xl border border-border bg-surface px-3 py-2.5">
        <ChatPicker
          id="exclude"
          label="Exclude chats"
          picked={excludeChats}
          chats={chats}
          search={excludeSearch}
          onSearch={setExcludeSearch}
          onToggle={(id) => setExcludeChats((list) => toggle(list, id))}
        />
      </div>
    </section>
  );
}

function FolderIconPicker({
  name,
  setName,
  icon,
  setIcon,
}: {
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  icon: FolderIcon;
  setIcon: Dispatch<SetStateAction<FolderIcon>>;
}) {
  return (
    <section aria-label="Name and icon">
      <h3 className={SECTION_LABEL}>Name and icon</h3>
      <div className="mt-2 rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <label htmlFor="folder-name" className="sr-only">
            Name
          </label>
          <input
            id="folder-name"
            type="text"
            value={name}
            maxLength={FOLDER_NAME_MAX}
            data-autofocus
            onChange={(event) => setName(event.target.value)}
            placeholder="Folder name"
            className="min-w-0 flex-1 bg-transparent text-[15px] focus-visible:outline-none"
          />
          <span
            data-testid="folder-name-counter"
            className="shrink-0 text-[13px] text-muted-foreground tabular-nums"
          >
            {Math.min(name.length, FOLDER_NAME_MAX)}/{FOLDER_NAME_MAX}
          </span>
        </div>
        <div className="border-t border-border px-3 py-2.5">
          <div role="radiogroup" aria-label="Icon" className="grid grid-cols-6 gap-1">
            {FOLDER_ICONS.map((iconName) => {
              const Icon = folderIconComponent(iconName);
              const selected = icon === iconName;
              return (
                <button
                  key={iconName}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={iconName}
                  title={iconName}
                  onClick={() => setIcon(iconName)}
                  className={cn(
                    'flex items-center justify-center rounded-xl p-2 transition-colors hover:text-foreground',
                    selected ? 'key-icon text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function FolderEditorDialog({
  folder,
  onClose,
}: {
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

  // One busy state drops a second write, including a save during a delete.
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
        busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave && !busy) {
            runWrite('save');
          }
        }}
        {...(writeFailure === undefined
          ? {}
          : {
              error:
                writeFailure._tag === 'FolderDeleteFailed'
                  ? 'Could not delete the folder. Try again.'
                  : saveErrorMessage(writeFailure),
            })}
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
            <Button
              type="submit"
              variant="default"
              size="lg"
              className="ml-auto"
              disabled={!canSave || busy}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
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

        {/* The confirm is a React child of the dialog,
            so Base UI nests it and Escape closes only the confirm. */}
        {confirmingDelete && folder !== null && (
          <ConfirmDialog
            title="Delete folder"
            body={`Delete the folder ${folder.name}? Chats stay where they are.`}
            confirmLabel="Delete"
            onConfirm={() => runWrite('delete')}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </Dialog>
    </>
  );
}
