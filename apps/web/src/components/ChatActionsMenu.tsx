import type { ChatSummary } from '@zilar/chat-core';
import { Data, Effect } from 'effect';
import { Archive, Bell, BellOff, Pin, PinOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { MUTE_DURATIONS } from '@/lib/chatPrefs';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';
import { Menu, MenuItem, type MenuItemProps } from './ui/menu';

const SAVE_ERROR = 'Could not save that change';

/** The chat store rejected a change; the menu shows the fixed sentence. */
class PrefSaveFailed extends Data.TaggedError('PrefSaveFailed') {}

/**
 * One menu entry with its own save, so two entries can run at the same time
 * and a second click on the same entry while it waits is ignored. The
 * parent shows the error sentence and gets told whether the change failed.
 */
function PrefMenuItem({
  save,
  onDone,
  onError,
  children,
  ...item
}: Omit<MenuItemProps, 'onSelect'> & {
  save: () => Promise<void>;
  onDone: (failed: boolean) => void;
  onError: (message: string | undefined) => void;
}) {
  const [state, runSave] = useAction<void, void, PrefSaveFailed>(() =>
    Effect.tryPromise({ try: save, catch: () => new PrefSaveFailed() }).pipe(
      Effect.tap(() => Effect.sync(() => onDone(false))),
      Effect.tapError(() =>
        Effect.sync(() => {
          onError(SAVE_ERROR);
          onDone(true);
        }),
      ),
    ),
  );
  const busy = isWaiting(state);
  const startSave = (): void => {
    if (busy) {
      return;
    }
    onError(undefined);
    runSave();
  };

  return (
    <MenuItem {...item} onSelect={startSave}>
      {children}
    </MenuItem>
  );
}

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

  return (
    <>
      <PrefMenuItem
        icon={PinIcon}
        ariaLabel={pinned ? `Unpin ${chat.title}` : `Pin ${chat.title}`}
        save={() => storeApi.getState().setPinned(chat.id, !pinned)}
        onDone={onDone}
        onError={setError}
      >
        {pinned ? 'Unpin' : 'Pin'}
      </PrefMenuItem>
      {muteOpen ? (
        <div aria-label="Mute duration" className="border-t border-border">
          {MUTE_DURATIONS.map((option) => (
            <PrefMenuItem
              key={option.id}
              save={() => storeApi.getState().setMuted(chat.id, option.id)}
              onDone={onDone}
              onError={setError}
            >
              {option.label}
            </PrefMenuItem>
          ))}
          {chat.muted && (
            <PrefMenuItem
              save={() => storeApi.getState().setMuted(chat.id, null)}
              onDone={onDone}
              onError={setError}
            >
              Unmute
            </PrefMenuItem>
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
      <PrefMenuItem
        icon={Archive}
        ariaLabel={archived ? `Unarchive chat ${chat.title}` : `Archive chat ${chat.title}`}
        save={() => storeApi.getState().setArchived(chat.id, !archived)}
        onDone={onDone}
        onError={setError}
      >
        {archived ? 'Unarchive chat' : 'Archive chat'}
      </PrefMenuItem>
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
