import { useMemo } from 'react';
import { X } from 'lucide-react';
import { FOLDER_CHATS_MAX } from '@zilar/chat-core';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchField } from '@/components/ui/search-field';

export function ChatPicker({
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
