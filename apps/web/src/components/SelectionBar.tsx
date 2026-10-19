import { deleteActionFor, type ChatSummary, type UiMessage } from '@zilar/chat-core';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { Button } from './ui/button';
import { useToast } from './ui/toast';
import { copyText } from '@/lib/clipboard';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

const EMPTY_MESSAGES: UiMessage[] = [];

export function SelectionBar({
  chat,
  selectedIds,
  onForward,
  onCancel,
}: {
  chat: ChatSummary;
  selectedIds: string[];
  onForward: () => void;
  onCancel: () => void;
}) {
  const storeApi = useChatStoreApi();
  const show = useToast();
  const meId = useChatSelector((s) => s.currentUserId);
  const stored = useChatSelector((s) => s.messagesByChat[chat.id]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selected = useMemo(() => {
    const ids = new Set(selectedIds);
    return (stored ?? EMPTY_MESSAGES).filter((message) => ids.has(message.id));
  }, [stored, selectedIds]);

  const isDm = chat.kind === 'dm' && chat.isAI !== true;
  const deletable = useMemo(
    () => selected.filter((message) => deleteActionFor(message, meId, isDm) !== 'none'),
    [selected, meId, isDm],
  );
  // "Delete for everyone" is offered only when every deletable message is mine.
  const allMine = deletable.every((message) => message.senderId === meId);
  const copyable = selected.filter(
    (message) => message.deleted !== true && (message.text ?? '').length > 0,
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !confirmOpen) {
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, confirmOpen]);

  const deleteForMe = (): void => {
    for (const message of deletable) {
      storeApi.getState().deleteForMe(chat.id, message.id);
    }
  };
  const deleteForEveryone = (): void => {
    for (const message of deletable) {
      storeApi.getState().deleteForEveryone(chat.id, message.id);
    }
  };

  const copySelected = (): void => {
    show('Copied');
    void copyText(
      copyable.map((message) => `${message.senderName}: ${message.text ?? ''}`).join('\n'),
    );
  };

  const count = selectedIds.length;
  const plural = deletable.length > 1;
  const deleteTitle = plural ? 'Delete messages?' : 'Delete message?';

  return (
    <div className="pointer-events-none relative px-3 pt-2 pb-3 *:pointer-events-auto wide:px-8 wide:pt-3 wide:pb-5">
      <div className="flex items-center gap-3 rounded-[14px] bg-surface-raised px-4 py-2.5">
        <p aria-live="polite" className="min-w-0 flex-1 truncate text-[14px] font-medium">
          {count} selected
        </p>
        <Button type="button" variant="outline" className="shrink-0" onClick={onCancel}>
          Cancel
        </Button>
        {deletable.length > 0 && (
          <Button
            type="button"
            variant="destructive"
            className="shrink-0"
            onClick={() => setConfirmOpen(true)}
          >
            Delete
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          disabled={copyable.length === 0}
          onClick={copySelected}
        >
          Copy
        </Button>
        <Button type="button" className="shrink-0" disabled={count === 0} onClick={onForward}>
          Forward
        </Button>
      </div>
      {confirmOpen && deletable.length > 0 && isDm && allMine && (
        <ConfirmDialog
          title={deleteTitle}
          body={
            plural
              ? 'Delete them for you only, or for everyone in the chat.'
              : 'Delete it for you only, or for everyone in the chat.'
          }
          confirmLabel="Delete for everyone"
          secondLabel="Delete for me"
          onCancel={() => setConfirmOpen(false)}
          onSecond={() => {
            setConfirmOpen(false);
            deleteForMe();
            onCancel();
          }}
          onConfirm={() => {
            setConfirmOpen(false);
            deleteForEveryone();
            onCancel();
          }}
        />
      )}
      {confirmOpen && deletable.length > 0 && !(isDm && allMine) && (
        <ConfirmDialog
          title={deleteTitle}
          body={
            isDm
              ? plural
                ? 'This removes them from your chat only.'
                : `This removes it from your chat only. ${deletable[0]?.senderName ?? ''} still has it.`
              : plural
                ? 'This deletes them for everyone in the chat.'
                : 'This deletes it for everyone in the chat.'
          }
          confirmLabel={isDm ? 'Delete for me' : 'Delete'}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            if (isDm) {
              deleteForMe();
            } else {
              deleteForEveryone();
            }
            onCancel();
          }}
        />
      )}
    </div>
  );
}
