import { Data, Effect } from 'effect';
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  FOLDER_CHATS_MAX,
  FOLDER_ICONS,
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
import { folderIconComponent } from './folderIcon';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Switch } from './ui/switch';
import { SearchField } from './ui/search-field';
import { cn } from '@/lib/utils';

const TYPE_SWITCHES: { type: FolderChatType; label: string }[] = [
  { type: 'dm', label: 'Personal chats' },
  { type: 'group', label: 'Groups' },
  { type: 'channel', label: 'Channels' },
  { type: 'ai', label: 'AIs' },
];

const SECTION_LABEL = 'text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase';

class FolderDeleteFailed extends Data.TaggedError('FolderDeleteFailed') {}

/** The two writes of this dialog; one action runs them, so they never overlap. */
type FolderWrite = 'save' | 'delete';

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

function ChatPicker({
  id,
  label,
  picked,
  chats,
  search,
  onSearch,
  onToggle,
}: {
  id: string;
  label: string;
  picked: string[];
  chats: { id: string; title: string; topic?: unknown; archived?: boolean }[];
  search: string;
  onSearch: (value: string) => void;
  onToggle: (id: string) => void;
}) {
  const full = picked.length >= FOLDER_CHATS_MAX;
  // Topics are rows of their group, archived chats are hidden everywhere:
  // neither can be picked into a folder. Chats that were picked before and
  // are no longer pickable still show as removable rows below.
  const query = search.trim().toLowerCase();
  const pickable = chats.filter(
    (chat) =>
      chat.topic === undefined && !chat.archived && chat.title.toLowerCase().includes(query),
  );
  const stale = useMemo(
    () =>
      picked
        .map((chatId) => chats.find((chat) => chat.id === chatId))
        .filter(
          (chat): chat is { id: string; title: string; topic?: unknown; archived?: boolean } =>
            chat !== undefined && (chat.topic !== undefined || chat.archived === true),
        ),
    [picked, chats],
  );
  const searchId = `folder-chat-search-${id}`;
  return (
    <div>
      <p className="text-[14px] font-medium">{label}</p>
      <label htmlFor={searchId} className="sr-only">
        {`Search ${label.toLowerCase()}`}
      </label>
      <SearchField
        id={searchId}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={`Search ${label.toLowerCase()}`}
        className="mt-2"
      />
      <ul className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        {pickable.map((chat) => {
          const checked = picked.includes(chat.id);
          return (
            <li key={`${id}-${chat.id}`}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[15px] hover:bg-list-hover">
                <Checkbox
                  checked={checked}
                  disabled={!checked && full}
                  onCheckedChange={() => onToggle(chat.id)}
                />
                <span className="truncate">{chat.title}</span>
              </label>
            </li>
          );
        })}
        {stale.map((chat) => (
          <li
            key={`${id}-stale-${chat.id}`}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-[15px] text-muted-foreground"
          >
            <span className="min-w-0 flex-1 truncate">
              {chat.title} <span className="text-[13px]">(archived)</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 rounded-full"
              aria-label={`Remove ${chat.title}`}
              title={`Remove ${chat.title}`}
              onClick={() => onToggle(chat.id)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {picked.length} of {FOLDER_CHATS_MAX} selected
      </p>
    </div>
  );
}

function saveErrorMessage(error: ApiFailure): string {
  if (error.code === 'folder_limit') {
    return error.message;
  }
  if (error.code === 'rate_limited') {
    return 'Too many changes. Wait a moment.';
  }
  return 'Could not save the folder. Try again.';
}
