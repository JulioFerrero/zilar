import { canAct, QUICK_REACTIONS, type UiMessage, safeHttpUrl } from '@zilar/chat-core';
import { Effect } from 'effect';
import {
  Copy,
  Download,
  Forward,
  ListChecks,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Reply,
  Trash2,
} from 'lucide-react';
import type { RefObject } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { EmojiTab } from '../sticker/EmojiTab';
import { Dialog } from '../ui/dialog';
import { Menu, MenuEntry, MenuItem } from '../ui/menu';
import { useToast } from '../ui/toast';
import { useAlbumMembers } from '@zilar/client-core';
import type { MessageMenuState } from './use-message-menu';
import { mediaSrc } from '@/lib/attachments';
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
  point?: { x: number; y: number } | undefined;
  onReply: () => void;
  onForward: () => void;
  onSelectMessages: () => void;
  onReact: (emoji: string) => void;
  onClose: () => void;
}

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
  const albumIds =
    message.album !== undefined && members !== null && members.length >= 2
      ? members.map((member) => member.id)
      : undefined;
  const deleteTitle = albumIds === undefined ? 'Delete message?' : 'Delete album?';
  const deleteIds = albumIds ?? [message.id];
  const chat = useChatSelector((s) => s.chats.find((entry) => entry.id === chatId));
  const meId = useChatSelector((s) => s.currentUserId);
  const own = message.senderId === meId;
  // A message with no wire id yet (still sending, or a failed send) is refused
  // by React, Edit and Delete: hide or disable them instead of a dead tap.
  const canActNow = canAct(message);
  const isDm = chat?.kind === 'dm' && chat.isAI !== true;
  const canDeleteForMe = isDm && message.deleted !== true && message.status !== 'sending';
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
  const fileAttachment =
    message.attachment !== undefined && message.attachment.kind === 'file'
      ? message.attachment
      : undefined;
  const fileHref =
    fileAttachment === undefined || safeHttpUrl(fileAttachment.url) === undefined
      ? undefined
      : mediaSrc(chatId, fileAttachment.url);
  const right = align === 'right';

  return (
    <>
      {open && (
        <Menu
          open
          onOpenChange={(next) => {
            if (!next) {
              onClose();
            }
          }}
          label="Message actions"
          align={point === undefined ? (right ? 'end' : 'start') : 'start'}
          sideOffset={0}
          {...(point === undefined
            ? {
                anchorClassName: right ? 'absolute top-6 right-0' : 'absolute top-6 left-0',
              }
            : {
                point,
              })}
        >
          <div className="flex items-center justify-between gap-0.5 px-2 pb-1">
            {QUICK_REACTIONS.map((emoji) => (
              <MenuEntry
                key={emoji}
                ariaLabel={`React with ${emoji}`}
                disabled={!canActNow}
                onSelect={() => {
                  onClose();
                  onReact(emoji);
                }}
                className="key-icon flex size-7 items-center justify-center rounded-full text-[17px] leading-none"
              >
                <span aria-hidden="true">{emoji}</span>
              </MenuEntry>
            ))}
            <MenuEntry
              ariaLabel="More reactions"
              disabled={!canActNow}
              onSelect={() => {
                onClose();
                menu.openPicker();
              }}
              className="key-icon flex size-7 items-center justify-center rounded-full text-muted-foreground"
            >
              <Plus className="size-4" aria-hidden="true" />
            </MenuEntry>
          </div>
          <MenuItem
            onSelect={() => {
              onClose();
              onReply();
            }}
            icon={Reply}
          >
            Reply
          </MenuItem>
          {canForward && (
            <>
              <MenuItem
                onSelect={() => {
                  onClose();
                  onForward();
                }}
                icon={Forward}
              >
                Forward
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  onClose();
                  onSelectMessages();
                }}
                icon={ListChecks}
              >
                Select
              </MenuItem>
            </>
          )}
          {canEdit && canActNow && (
            <MenuItem
              onSelect={() => {
                onClose();
                storeApi.getState().startEdit(chatId, message.id);
              }}
              icon={Pencil}
            >
              Edit
            </MenuItem>
          )}
          <MenuItem
            onSelect={() => {
              onClose();
              show('Copied');
              void copyText(message.text ?? '');
            }}
            disabled={!canCopy}
            icon={Copy}
          >
            Copy text
          </MenuItem>
          {fileHref !== undefined && (
            <MenuItem
              onSelect={() => {
                onClose();
                if (fileAttachment !== undefined) {
                  downloadFile(fileHref, fileAttachment.name);
                }
              }}
              icon={Download}
            >
              Download
            </MenuItem>
          )}
          <MenuItem
            onSelect={() => {
              onClose();
              menuButtonRef.current?.focus();
              menu.openConfirm();
            }}
            disabled={!((canDelete || canDeleteForMe) && canActNow)}
            destructive
            icon={Trash2}
          >
            {deleteLabel}
          </MenuItem>
          {canPin &&
            (pinId !== undefined ? (
              <MenuItem
                onSelect={() => {
                  onClose();
                  if (pinId !== undefined) {
                    runWithFeedback(
                      () => storeApi.getState().unpinMessage(chatId, pinId),
                      show,
                      'Unpinned',
                    );
                  }
                }}
                icon={PinOff}
              >
                Unpin
              </MenuItem>
            ) : (
              <MenuItem
                onSelect={() => {
                  onClose();
                  runWithFeedback(
                    () => storeApi.getState().pinMessage(chatId, message.id),
                    show,
                    'Pinned',
                  );
                }}
                icon={Pin}
              >
                Pin
              </MenuItem>
            ))}
        </Menu>
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
