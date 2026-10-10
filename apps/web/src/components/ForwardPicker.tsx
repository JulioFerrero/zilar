import { useMemo, useState } from 'react';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { Avatar } from './Avatar';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog } from './ui/dialog';
import { SearchField } from './ui/search-field';
import { TextArea } from './ui/text-input';

/** A topic row reads `Group › Topic`; everything else is just its title. */
function targetLabel(chat: ChatSummary): string {
  return chat.topic !== undefined && chat.groupTitle !== undefined
    ? `${chat.groupTitle} › ${chat.title}`
    : chat.title;
}

/**
 * A channel row is offered only where the caller may post; a plain member (or
 * an unknown role) has no voice in the feed room.
 */
function canPostTo(chat: ChatSummary): boolean {
  if (chat.chatKind !== 'channel') {
    return true;
  }
  return chat.myRole === 'owner' || chat.myRole === 'admin';
}

/**
 * Picks one or more target chats for a forward (T-0419). Several targets are
 * allowed; the optional comment rides along as a separate message per target
 * (the store action already splits it). Archived chats and non-postable
 * channels are never offered.
 */
export function ForwardPicker({
  messages,
  onClose,
}: {
  messages: UiMessage[];
  onClose: () => void;
}) {
  const chats = useChatSelector((s) => s.chats);
  const storeApi = useChatStoreApi();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [comment, setComment] = useState('');

  const targets = useMemo(() => {
    const search = query.trim().toLowerCase();
    return chats.filter((chat) => {
      if (chat.archived === true || !canPostTo(chat)) {
        return false;
      }
      if (search.length === 0) {
        return true;
      }
      return (
        chat.title.toLowerCase().includes(search) ||
        (chat.groupTitle !== undefined && chat.groupTitle.toLowerCase().includes(search))
      );
    });
  }, [chats, query]);

  const toggle = (chatId: string): void => {
    setSelected((current) =>
      current.includes(chatId) ? current.filter((id) => id !== chatId) : [...current, chatId],
    );
  };

  const send = (): void => {
    if (selected.length === 0) {
      return;
    }
    const trimmed = comment.trim();
    storeApi
      .getState()
      .forwardMessages(selected, messages, trimmed === '' ? undefined : { comment: trimmed });
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Forward"
      actions={
        <>
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="lg" disabled={selected.length === 0} onClick={send}>
            {selected.length > 1 ? `Send to ${selected.length} chats` : 'Send'}
          </Button>
        </>
      }
    >
      <SearchField
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search chats"
        aria-label="Search chats"
        className="mt-3"
      />
      <div className="mt-2">
        {targets.length === 0 ? (
          <p className="py-6 text-center text-[14px] text-muted-foreground">No chats found</p>
        ) : (
          targets.map((chat) => (
            <label
              key={chat.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-list-hover"
            >
              <Checkbox
                checked={selected.includes(chat.id)}
                onCheckedChange={() => toggle(chat.id)}
              />
              <Avatar
                id={chat.id}
                name={chat.title}
                size={28}
                ai={chat.isAI}
                avatarUrl={chat.avatarUrl}
              />
              <span className="truncate text-[15px]">{targetLabel(chat)}</span>
            </label>
          ))
        )}
      </div>
      <div className="mt-3">
        <TextArea
          label="Add a comment (optional)"
          value={comment}
          rows={2}
          onChange={(event) => setComment(event.target.value)}
          className="min-h-0 resize-none"
        />
      </div>
    </Dialog>
  );
}
