import type { ChatSummary } from '@zilar/chat-core';
import { Data, Effect } from 'effect';
import { Archive, Bell, BellOff, Eraser, Mail, MailOpen, Pin, PinOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { MUTE_DURATIONS } from '@/lib/chatPrefs';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { ConfirmDialog } from './ConfirmDialog';
import { Menu, MenuItem, type MenuItemProps } from './ui/menu';

const SAVE_ERROR = 'Could not save that change';
/** The same fixed line the store sets when a delete call fails. */
const DELETE_ERROR = 'Could not delete. Try again.';

class PrefSaveFailed extends Data.TaggedError('PrefSaveFailed') {}

/** One entry with its own save, so two entries can run at once. */
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
    <MenuItem
      {...item}
      // Stay open until the save settles so a failure can show its sentence.
      closeOnClick={false}
      onSelect={startSave}
    >
      {children}
    </MenuItem>
  );
}

/** Pin / Mute / Archive items for one chat row, shared by the row, header and topic menus. */
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
  const [clearOpen, setClearOpen] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const pinned = chat.pinnedAt !== undefined;
  const archived = chat.archived === true;
  const marked = chat.unreadMark === true;
  const showMarkRead = chat.unread > 0 || marked;
  const PinIcon = pinned ? PinOff : Pin;

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
      {chat.muted ? (
        <PrefMenuItem
          icon={Bell}
          ariaLabel={`Unmute ${chat.title}`}
          save={() => storeApi.getState().setMuted(chat.id, null)}
          onDone={onDone}
          onError={setError}
        >
          Unmute
        </PrefMenuItem>
      ) : muteOpen ? (
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
        </div>
      ) : (
        <MenuItem
          icon={BellOff}
          ariaLabel={`Mute ${chat.title}`}
          closeOnClick={false}
          onSelect={() => setMuteOpen(true)}
        >
          Mute…
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
      {showMarkRead ? (
        <PrefMenuItem
          icon={MailOpen}
          ariaLabel={`Mark ${chat.title} as read`}
          save={() => storeApi.getState().markChatRead(chat.id)}
          onDone={onDone}
          onError={setError}
        >
          Mark as read
        </PrefMenuItem>
      ) : (
        <PrefMenuItem
          icon={Mail}
          ariaLabel={`Mark ${chat.title} as unread`}
          save={() => storeApi.getState().setUnreadMark(chat.id, true)}
          onDone={onDone}
          onError={setError}
        >
          Mark as unread
        </PrefMenuItem>
      )}
      {error !== undefined && (
        <p role="alert" className="px-3 py-1 text-[13px] text-danger">
          {error}
        </p>
      )}
      {chat.kind === 'dm' && (
        <MenuItem
          icon={Eraser}
          ariaLabel={`Clear history with ${chat.title}`}
          closeOnClick={false}
          onSelect={() => setClearOpen(true)}
        >
          Clear history
        </MenuItem>
      )}
      {children}
      {clearOpen && (
        <ConfirmDialog
          title="Clear history?"
          body={`Clear your history with ${chat.title}? This removes every message from your side only. ${chat.title} keeps theirs.`}
          confirmLabel="Clear history"
          onCancel={() => setClearOpen(false)}
          onConfirm={() => {
            setClearOpen(false);
            void storeApi
              .getState()
              .clearHistory(chat.id)
              .then((outcome) => {
                const failed = outcome === 'failed';
                if (failed) {
                  setError(DELETE_ERROR);
                }
                onDone(failed);
              });
          }}
        />
      )}
    </>
  );
}

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
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      label={`Actions for ${chat.title}`}
      align={align === 'right' ? 'end' : 'start'}
      sideOffset={0}
      anchorClassName={align === 'right' ? 'absolute top-6 right-0' : 'absolute top-6 left-0'}
    >
      <ChatPrefMenuItems chat={chat} onDone={(failed) => !failed && onClose()} />
    </Menu>
  );
}
