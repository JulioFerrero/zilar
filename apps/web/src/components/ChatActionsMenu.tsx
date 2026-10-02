import type { ChatSummary } from '@zilar/chat-core';
import { Archive, Bell, BellOff, Pin, PinOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { MUTE_DURATIONS, type MuteDurationId } from '@/lib/chatPrefs';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

export const CHAT_MENU_ITEM_CLASS =
  'flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none disabled:opacity-50';

/** Pin / Mute / Archive items for one chat row, shared by the row menu, the
 *  header menu and the topic menu. `children` renders after the Archive
 *  entry (e.g. the manager's "Archive topic for everyone" under a divider).
 */
export function ChatPrefMenuItems({
  chat,
  onDone,
  children,
}: {
  chat: ChatSummary;
  onDone: (failed: boolean) => void;
  children?: ReactNode;
}) {
  const storeApi = useChatStoreApi();
  const [muteOpen, setMuteOpen] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const pinned = chat.pinnedAt !== undefined;
  const archived = chat.archived === true;

  async function run(action: () => Promise<void>): Promise<void> {
    setError(undefined);
    try {
      await action();
      onDone(false);
    } catch {
      setError('Could not save that change');
      onDone(true);
    }
  }

  function mute(duration: MuteDurationId): void {
    void run(() => storeApi.getState().setMuted(chat.id, duration));
  }

  return (
    <>
      <button
        type="button"
        role="menuitem"
        aria-label={pinned ? `Unpin ${chat.title}` : `Pin ${chat.title}`}
        onClick={() => void run(() => storeApi.getState().setPinned(chat.id, !pinned))}
        className={CHAT_MENU_ITEM_CLASS}
      >
        {pinned ? (
          <PinOff className="size-4" aria-hidden="true" />
        ) : (
          <Pin className="size-4" aria-hidden="true" />
        )}
        {pinned ? 'Unpin' : 'Pin'}
      </button>
      {muteOpen ? (
        <div aria-label="Mute duration" className="border-t border-border">
          {MUTE_DURATIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              onClick={() => mute(option.id)}
              className={CHAT_MENU_ITEM_CLASS}
            >
              {option.label}
            </button>
          ))}
          {chat.muted && (
            <button
              type="button"
              role="menuitem"
              onClick={() => void run(() => storeApi.getState().setMuted(chat.id, null))}
              className={CHAT_MENU_ITEM_CLASS}
            >
              Unmute
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          role="menuitem"
          aria-label={chat.muted ? `Change mute for ${chat.title}` : `Mute ${chat.title}`}
          onClick={() => setMuteOpen(true)}
          className={CHAT_MENU_ITEM_CLASS}
        >
          {chat.muted ? (
            <Bell className="size-4" aria-hidden="true" />
          ) : (
            <BellOff className="size-4" aria-hidden="true" />
          )}
          {chat.muted ? 'Mute…' : 'Mute'}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        aria-label={archived ? `Unarchive chat ${chat.title}` : `Archive chat ${chat.title}`}
        onClick={() => void run(() => storeApi.getState().setArchived(chat.id, !archived))}
        className={CHAT_MENU_ITEM_CLASS}
      >
        <Archive className="size-4" aria-hidden="true" />
        {archived ? 'Unarchive chat' : 'Archive chat'}
      </button>
      {error !== undefined && (
        <p role="alert" className="px-3 py-1 text-[13px] text-danger">
          {error}
        </p>
      )}
      {children}
    </>
  );
}

/** Pin / Mute / Archive menu for a chat row (the floating variant). */
export function ChatActionsMenu({
  chat,
  onClose,
  align = 'right',
}: {
  chat: ChatSummary;
  onClose: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close chat menu"
        onClick={onClose}
        className="fixed inset-0 z-20 cursor-default"
      />
      <div
        role="menu"
        aria-label={`Actions for ${chat.title}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
        className={cn(
          'absolute top-6 z-30 min-w-[196px] rounded-[12px] border border-border-strong bg-surface py-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)]',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        <ChatPrefMenuItems chat={chat} onDone={() => onClose()} />
      </div>
    </>
  );
}
