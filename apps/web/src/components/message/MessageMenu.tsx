import { canAct, type UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';
import { MoreHorizontal } from 'lucide-react';
import { useState, type RefObject } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { MessageActionsMenu } from '../MessageActionsMenu';
import { EmojiTab } from '../sticker/EmojiTab';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { useToast } from '../ui/toast';
import { useAlbumMembers } from './AlbumGrid';
import { mediaSrc, safeHttpUrl } from '@/lib/attachments';
import { copyText } from '@/lib/clipboard';
import { runWeb } from '@/lib/effect/runtime';
import { downloadFile } from '@/lib/open-file';
import { cn } from '@/lib/utils';
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
  beside,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onOpen: () => void;
  /**
   * A bubble-less big-emoji message (T-1327) has no frame to sit on, so the
   * button moves beside the emoji, on that side, instead of covering it.
   */
  beside?: 'left' | 'right' | undefined;
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
      className={cn(
        'absolute top-0.5 right-0.5 z-10 size-6 rounded-full bg-surface/80 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
        beside === 'left' && 'top-1/2 right-auto -left-7 -translate-y-1/2',
        beside === 'right' && 'top-1/2 -right-7 -translate-y-1/2',
      )}
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
  // T-1933: the + key in the reaction row opens the full emoji picker. It stays
  // mounted outside `open &&` because opening it closes the menu.
  const [pickerOpen, setPickerOpen] = useState(false);
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
  // A message with no wire id yet (still sending, or a failed send) is refused
  // by React, Edit and Delete: hide or disable them instead of letting the tap
  // do nothing (UI-7).
  const canActNow = canAct(message);
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
  // T-1325: a `kind: 'file'` attachment gets a Download item in the menu, so the
  // file bubble keeps a single circle. The URL is resolved exactly as the file
  // bubble resolves it, so a same-origin `/upload/` goes through `GET /api/files`.
  const fileAttachment =
    message.attachment !== undefined && message.attachment.kind === 'file'
      ? message.attachment
      : undefined;
  const fileHref =
    fileAttachment === undefined || safeHttpUrl(fileAttachment.url) === undefined
      ? undefined
      : mediaSrc(chatId, fileAttachment.url);

  return (
    <>
      {open && (
        <MessageActionsMenu
          canCopy={canCopy}
          canEdit={canEdit && canActNow}
          canDelete={(canDelete || canDeleteForMe) && canActNow}
          canReact={canActNow}
          deleteLabel={deleteLabel}
          canPin={canPin}
          isPinned={pinId !== undefined}
          canForward={canForward}
          canDownload={fileHref !== undefined}
          point={point}
          onReact={(emoji) => {
            onClose();
            onReact(emoji);
          }}
          onMoreReactions={() => {
            onClose();
            setPickerOpen(true);
          }}
          onReply={() => {
            onClose();
            onReply();
          }}
          onForward={() => {
            onClose();
            onForward();
          }}
          onDownload={() => {
            onClose();
            if (fileHref !== undefined && fileAttachment !== undefined) {
              downloadFile(fileHref, fileAttachment.name);
            }
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
      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} title="React" size="sm">
        <EmojiTab
          onEmoji={(emoji) => {
            setPickerOpen(false);
            onReact(emoji);
          }}
        />
      </Dialog>
    </>
  );
}
