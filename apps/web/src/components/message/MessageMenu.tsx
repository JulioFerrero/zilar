import { type UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';
import { MoreHorizontal } from 'lucide-react';
import { useState, type RefObject } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { MessageActionsMenu } from '../MessageActionsMenu';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';
import { useAlbumMembers } from './AlbumGrid';
import { copyText } from '@/lib/clipboard';
import { runWeb } from '@/lib/effect/runtime';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

/**
 * Runs a store call the user does not wait for (pin, unpin). Unlike the old
 * empty handler, it reports the outcome: `success` on resolve, the fixed pin
 * error on reject (WUX-30).
 */
function runWithFeedback(
  call: () => Promise<unknown>,
  show: (text: string) => void,
  success: string,
): void {
  void runWeb(
    Effect.promise(call).pipe(
      Effect.match({
        onFailure: () => show('Could not pin. Try again.'),
        onSuccess: () => show(success),
      }),
    ),
  );
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
  point,
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
  /** A right-click point; the menu opens there instead of at the bubble (WUX-29). */
  point?: { x: number; y: number } | undefined;
  onReply: () => void;
  onForward: () => void;
  onSelectMessages: () => void;
  onReact: (emoji: string) => void;
  onClose: () => void;
}) {
  const storeApi = useChatStoreApi();
  const show = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const members = useAlbumMembers();
  // T-1273: on an album bubble the menu acts on every photo. The list row hands
  // the grid its grouped members; with two or more, Delete loops over all of
  // them (an album is one sender, so the own/peer rule is unchanged). A lone
  // photo, or a bubble drawn without members, keeps the single-message action.
  const albumIds =
    message.album !== undefined && members !== null && members.length >= 2
      ? members.map((member) => member.id)
      : undefined;
  const deleteTitle = albumIds === undefined ? 'Delete message?' : 'Delete album?';
  const deleteIds = albumIds ?? [message.id];
  // T-1247: in a DM (and not an AI chat) every message can be deleted for me.
  const chat = useChatSelector((s) => s.chats.find((entry) => entry.id === chatId));
  const meId = useChatSelector((s) => s.currentUserId);
  const own = message.senderId === meId;
  const isDm = chat?.kind === 'dm' && chat.isAI !== true;
  const canDeleteForMe = isDm && message.deleted !== true && message.status !== 'sending';
  // T-1247: in a DM the item names the action its confirm offers (both for my
  // own message, "for me" only on the peer's); groups keep the old label.
  const deleteLabel = isDm ? (own ? 'Delete' : 'Delete for me') : 'Delete for everyone';
  const deleteForMe = (): void => {
    for (const id of deleteIds) {
      storeApi.getState().deleteForMe(chatId, id);
    }
  };
  const deleteForEveryone = (): void => {
    for (const id of deleteIds) {
      storeApi.getState().deleteForEveryone(chatId, id);
    }
  };

  return (
    <>
      {open && (
        <MessageActionsMenu
          canCopy={canCopy}
          canEdit={canEdit}
          canDelete={canDelete || canDeleteForMe}
          deleteLabel={deleteLabel}
          canPin={canPin}
          isPinned={pinId !== undefined}
          canForward={canForward}
          point={point}
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
            show('Copied');
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
            runWithFeedback(
              () => storeApi.getState().pinMessage(chatId, message.id),
              show,
              'Pinned',
            );
          }}
          onUnpin={() => {
            onClose();
            if (pinId !== undefined) {
              runWithFeedback(
                () => storeApi.getState().unpinMessage(chatId, pinId),
                show,
                'Unpinned',
              );
            }
          }}
          onClose={onClose}
          align={align}
        />
      )}
      {confirmOpen && isDm && own && (
        <ConfirmDialog
          title={deleteTitle}
          body="Delete it for you only, or for everyone in the chat."
          confirmLabel="Delete for everyone"
          secondLabel="Delete for me"
          onCancel={() => setConfirmOpen(false)}
          onSecond={() => {
            setConfirmOpen(false);
            deleteForMe();
          }}
          onConfirm={() => {
            setConfirmOpen(false);
            deleteForEveryone();
          }}
        />
      )}
      {confirmOpen && isDm && !own && (
        <ConfirmDialog
          title={deleteTitle}
          body={`This removes it from your chat only. ${message.senderName} still has it.`}
          confirmLabel="Delete for me"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            deleteForMe();
          }}
        />
      )}
      {confirmOpen && !isDm && (
        <ConfirmDialog
          title={deleteTitle}
          body="This deletes it for everyone in the chat."
          confirmLabel="Delete"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            deleteForEveryone();
          }}
        />
      )}
    </>
  );
}
