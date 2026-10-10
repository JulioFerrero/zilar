import { type UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';
import { MoreHorizontal } from 'lucide-react';
import { useState, type RefObject } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { MessageActionsMenu } from '../MessageActionsMenu';
import { Button } from '../ui/button';
import { copyText } from '@/lib/clipboard';
import { runWeb } from '@/lib/effect/runtime';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

/**
 * Runs a store call the user does not wait for (pin, unpin). Any failure is
 * dropped, as the old empty handler did.
 */
function runDetached(call: () => Promise<unknown>): void {
  void runWeb(Effect.promise(call).pipe(Effect.ignore));
}

/** The hover/focus "Message actions" button that opens the bubble menu. */
export function MessageActionsButton({
  buttonRef,
  open,
  onOpen,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Message actions"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onOpen}
      className="absolute top-0.5 right-0.5 z-10 size-6 rounded-full bg-surface/80 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
    >
      <MoreHorizontal className="size-4" aria-hidden="true" />
    </Button>
  );
}

export function MessageMenu({
  open,
  message,
  chatId,
  pinId,
  menuButtonRef,
  canCopy,
  canEdit,
  canDelete,
  canPin,
  canForward,
  align,
  onReply,
  onForward,
  onSelectMessages,
  onReact,
  onClose,
}: {
  open: boolean;
  message: UiMessage;
  chatId: string;
  pinId: string | undefined;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  canCopy: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  canForward: boolean;
  align: 'left' | 'right';
  onReply: () => void;
  onForward: () => void;
  onSelectMessages: () => void;
  onReact: (emoji: string) => void;
  onClose: () => void;
}) {
  const storeApi = useChatStoreApi();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      {open && (
        <MessageActionsMenu
          canCopy={canCopy}
          canEdit={canEdit}
          canDelete={canDelete}
          canPin={canPin}
          isPinned={pinId !== undefined}
          canForward={canForward}
          onReact={(emoji) => {
            onClose();
            onReact(emoji);
          }}
          onReply={() => {
            onClose();
            onReply();
          }}
          onForward={() => {
            onClose();
            onForward();
          }}
          onSelectMessages={() => {
            onClose();
            onSelectMessages();
          }}
          onEdit={() => {
            onClose();
            storeApi.getState().startEdit(chatId, message.id);
          }}
          onCopy={() => {
            onClose();
            void copyText(message.text ?? '');
          }}
          onDelete={() => {
            onClose();
            // Focus the opener so the dialog can restore it on close.
            menuButtonRef.current?.focus();
            setConfirmOpen(true);
          }}
          onPin={() => {
            onClose();
            runDetached(() => storeApi.getState().pinMessage(chatId, message.id));
          }}
          onUnpin={() => {
            onClose();
            if (pinId !== undefined) {
              runDetached(() => storeApi.getState().unpinMessage(chatId, pinId));
            }
          }}
          onClose={onClose}
          align={align}
        />
      )}
      {confirmOpen && (
        <ConfirmDialog
          title="Delete message?"
          body="This deletes it for everyone in the chat."
          confirmLabel="Delete"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            storeApi.getState().deleteForEveryone(chatId, message.id);
          }}
        />
      )}
    </>
  );
}
