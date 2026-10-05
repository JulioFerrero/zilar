import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Search, X } from 'lucide-react';
import {
  FOLDER_CHATS_MAX,
  FOLDER_ICONS,
  FOLDER_NAME_MAX,
  type ChatFolder,
  type FolderChatType,
  type FolderIcon,
} from '@zilar/chat-core';
import {
  ApiError,
  createChatFolder,
  deleteChatFolder,
  patchChatFolder,
  type ApiChatFolder,
} from '@/lib/api';
import { useChatStore } from '@/store/ChatStoreProvider';
import { folderIconComponent } from './folderIcon';
import { ConfirmDialog } from './ConfirmDialog';
import { cn } from '@/lib/utils';

const TYPE_SWITCHES: { type: FolderChatType; label: string }[] = [
  { type: 'dm', label: 'Personal chats' },
  { type: 'group', label: 'Groups' },
  { type: 'channel', label: 'Channels' },
  { type: 'ai', label: 'AIs' },
];

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const SECTION_LABEL = 'text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase';

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
  const store = useChatStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const [name, setName] = useState(folder?.name ?? '');
  const [icon, setIcon] = useState<FolderIcon>(folder?.icon ?? 'folder');
  const [includeTypes, setIncludeTypes] = useState<FolderChatType[]>(folder?.includeTypes ?? []);
  const [includeChats, setIncludeChats] = useState<string[]>(folder?.includeChats ?? []);
  const [excludeChats, setExcludeChats] = useState<string[]>(folder?.excludeChats ?? []);
  const [excludeMuted, setExcludeMuted] = useState(folder?.excludeMuted ?? false);
  const [excludeRead, setExcludeRead] = useState(folder?.excludeRead ?? false);
  const [includeSearch, setIncludeSearch] = useState('');
  const [excludeSearch, setExcludeSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    dialogRef.current?.querySelector<HTMLElement>('input')?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!confirmingDelete) {
        onClose();
      }
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusable === undefined || focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const trimmed = name.trim();
  const somethingIncluded = includeTypes.length > 0 || includeChats.length > 0;
  const canSave = trimmed.length >= 1 && trimmed.length <= FOLDER_NAME_MAX && somethingIncluded;

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  const save = async (): Promise<void> => {
    if (!canSave || busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
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
        const created = await createChatFolder(body);
        store.setFolders([...store.folders, created as ChatFolder]);
      } else {
        const updated = await patchChatFolder(folder.id, body);
        store.setFolders(
          store.folders.map((item) => (item.id === folder.id ? (updated as ChatFolder) : item)),
        );
      }
      onClose();
    } catch (saveError) {
      setError(saveErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (folder === null || busy) {
      return;
    }
    setBusy(true);
    try {
      await deleteChatFolder(folder.id);
      store.setFolders(store.folders.filter((item) => item.id !== folder.id));
      onClose();
    } catch {
      setConfirmingDelete(false);
      setError('Could not delete the folder. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={folder === null ? 'New folder' : `Edit folder ${folder.name}`}
        onClick={onClose}
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      >
        <div
          ref={dialogRef}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={onKeyDown}
          className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-xl"
        >
          <div className="shrink-0 border-b border-border px-5 py-4">
            <h2 className="text-[18px] font-semibold">
              {folder === null ? 'New folder' : 'Edit folder'}
            </h2>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
                        onChange={() =>
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
                  chats={store.chats}
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
                    onChange={() => setExcludeMuted((value) => !value)}
                  />
                </div>
                <div className="flex items-center gap-2 px-3 py-2 text-[15px]">
                  <span className="min-w-0 flex-1">Read chats</span>
                  <Switch
                    checked={excludeRead}
                    label="Read chats"
                    onChange={() => setExcludeRead((value) => !value)}
                  />
                </div>
              </div>
              <div className="mt-2 rounded-xl border border-border bg-surface px-3 py-2.5">
                <ChatPicker
                  id="exclude"
                  label="Exclude chats"
                  picked={excludeChats}
                  chats={store.chats}
                  search={excludeSearch}
                  onSearch={setExcludeSearch}
                  onToggle={(id) => setExcludeChats((list) => toggle(list, id))}
                />
              </div>
            </section>

            {error !== undefined && (
              <p role="alert" className="mt-4 text-[14px] text-danger">
                {error}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-5 py-3">
            {folder !== null && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="rounded-full px-4 py-1.5 text-[15px] font-medium text-danger hover:bg-list-hover focus-visible:outline-none"
              >
                Delete folder
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-4 py-1.5 text-[15px] text-muted-foreground hover:bg-list-hover focus-visible:outline-none"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSave || busy}
                onClick={() => void save()}
                className="key-primary rounded-full px-4 py-1.5 text-[15px] font-medium disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
      {confirmingDelete && folder !== null && (
        <ConfirmDialog
          title="Delete folder"
          body={`Delete the folder ${folder.name}? Chats stay where they are.`}
          confirmLabel="Delete"
          onConfirm={() => void remove()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  );
}

/** Small on/off switch for the folder type and hide rows. */
function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? 'bg-accent' : 'well-surface',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'key-icon absolute top-0.5 size-5 rounded-full transition-all',
          checked ? 'left-[22px]' : 'left-0.5',
        )}
      />
    </button>
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
      <div className="relative mt-2">
        <label htmlFor={searchId} className="sr-only">
          {`Search ${label.toLowerCase()}`}
        </label>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          id={searchId}
          type="text"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={`Search ${label.toLowerCase()}`}
          className="w-full rounded-xl border border-border bg-surface-raised py-2 pr-3 pl-9 text-[15px] focus-visible:outline-none"
        />
      </div>
      <ul className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        {pickable.map((chat) => {
          const checked = picked.includes(chat.id);
          return (
            <li key={`${id}-${chat.id}`}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[15px] hover:bg-list-hover">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && full}
                  onChange={() => onToggle(chat.id)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                    checked
                      ? 'border-transparent bg-accent text-accent-foreground'
                      : 'border-border-strong bg-transparent',
                    !checked && full && 'opacity-40',
                  )}
                >
                  {checked && <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
                </span>
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
            <button
              type="button"
              aria-label={`Remove ${chat.title}`}
              title={`Remove ${chat.title}`}
              onClick={() => onToggle(chat.id)}
              className="flex shrink-0 items-center justify-center rounded-full p-1 hover:bg-list-hover hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {picked.length} of {FOLDER_CHATS_MAX} selected
      </p>
    </div>
  );
}

function saveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'folder_limit') {
      return error.message;
    }
    if (error.code === 'rate_limited') {
      return 'Too many changes. Wait a moment.';
    }
  }
  return 'Could not save the folder. Try again.';
}
