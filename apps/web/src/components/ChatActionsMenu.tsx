import type { ChatSummary } from '@zilar/chat-core';
import { Archive, Bell, BellOff, Pin, PinOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { MUTE_DURATIONS, type MuteDurationId } from '@/lib/chatPrefs';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';
import { Menu, MenuItem } from './ui/menu';

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
  const PinIcon = pinned ? PinOff : Pin;
  const BellIcon = chat.muted ? Bell : BellOff;

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
      <MenuItem
        icon={PinIcon}
        ariaLabel={pinned ? `Unpin ${chat.title}` : `Pin ${chat.title}`}
        onSelect={() => void run(() => storeApi.getState().setPinned(chat.id, !pinned))}
      >
        {pinned ? 'Unpin' : 'Pin'}
      </MenuItem>
      {muteOpen ? (
        <div aria-label="Mute duration" className="border-t border-border">
          {MUTE_DURATIONS.map((option) => (
            <MenuItem key={option.id} onSelect={() => mute(option.id)}>
              {option.label}
            </MenuItem>
          ))}
          {chat.muted && (
            <MenuItem onSelect={() => void run(() => storeApi.getState().setMuted(chat.id, null))}>
              Unmute
            </MenuItem>
          )}
        </div>
      ) : (
        <MenuItem
          icon={BellIcon}
          ariaLabel={chat.muted ? `Change mute for ${chat.title}` : `Mute ${chat.title}`}
          onSelect={() => setMuteOpen(true)}
        >
          {chat.muted ? 'Mute…' : 'Mute'}
        </MenuItem>
      )}
      <MenuItem
        icon={Archive}
        ariaLabel={archived ? `Unarchive chat ${chat.title}` : `Archive chat ${chat.title}`}
        onSelect={() => void run(() => storeApi.getState().setArchived(chat.id, !archived))}
      >
        {archived ? 'Unarchive chat' : 'Archive chat'}
      </MenuItem>
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
    <Menu
      open
      onClose={onClose}
      label={`Actions for ${chat.title}`}
      closeLabel="Close chat menu"
      backdropClassName="z-20"
      className={cn(
        'top-6 z-30 min-w-[196px] rounded-[12px] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)]',
        align === 'right' ? 'right-0' : 'left-0',
      )}
    >
      <ChatPrefMenuItems chat={chat} onDone={() => onClose()} />
    </Menu>
  );
}
