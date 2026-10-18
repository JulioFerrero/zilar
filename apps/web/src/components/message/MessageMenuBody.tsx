import { canAct, type UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';
import type { RefObject } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { MessageActionsMenu } from '../MessageActionsMenu';
import { EmojiTab } from '../sticker/EmojiTab';
import { Dialog } from '../ui/dialog';
import { useToast } from '../ui/toast';
import { useAlbumMembers } from './AlbumGrid';
import type { MessageMenuState } from './use-message-menu';
import { mediaSrc, safeHttpUrl } from '@/lib/attachments';
import { copyText } from '@/lib/clipboard';
import { runWeb } from '@/lib/effect/runtime';
import { downloadFile } from '@/lib/open-file';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

export interface MessageMenuProps {
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
}

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

/**
 * The menu's visible part, mounted by the shell only while the menu or one of
 * its dialogs is open (T-2011), so a closed menu runs no store selectors while
 * an AI reply streams.
 */
export function MessageMenuBody({
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
  menu,
}: MessageMenuProps & { menu: MessageMenuState }) {
  const storeApi = useChatStoreApi();
  const show = useToast();
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
            menu.openPicker();
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
            menu.openConfirm();
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
      {menu.confirmOpen && isDm && own && (
        <ConfirmDialog
          title={deleteTitle}
          body="Delete it for you only, or for everyone in the chat."
          confirmLabel="Delete for everyone"
          secondLabel="Delete for me"
          onCancel={menu.closeConfirm}
          onSecond={() => {
            menu.closeConfirm();
            deleteForMe();
          }}
          onConfirm={() => {
            menu.closeConfirm();
            deleteForEveryone();
          }}
        />
      )}
      {menu.confirmOpen && isDm && !own && (
        <ConfirmDialog
          title={deleteTitle}
          body={`This removes it from your chat only. ${message.senderName} still has it.`}
          confirmLabel="Delete for me"
          onCancel={menu.closeConfirm}
          onConfirm={() => {
            menu.closeConfirm();
            deleteForMe();
          }}
        />
      )}
      {menu.confirmOpen && !isDm && (
        <ConfirmDialog
          title={deleteTitle}
          body="This deletes it for everyone in the chat."
          confirmLabel="Delete"
          onCancel={menu.closeConfirm}
          onConfirm={() => {
            menu.closeConfirm();
            deleteForEveryone();
          }}
        />
      )}
      <Dialog open={menu.pickerOpen} onClose={menu.closePicker} title="React" size="sm">
        <EmojiTab
          onEmoji={(emoji) => {
            menu.closePicker();
            onReact(emoji);
          }}
        />
      </Dialog>
    </>
  );
}
