import { Pin, X } from 'lucide-react';
import { useState } from 'react';
import { LinkText } from './LinkText';
import { Button } from './ui/button';
import { Sheet } from './ui/sheet';
import type { Pin as PinRow } from '@/lib/api';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';

const KIND_LABEL: Record<PinRow['kind'], string> = {
  text: '',
  image: 'Photo',
  file: 'File',
  voice: 'Voice message',
  card: 'Card',
};

/**
 * The pins panel (T-0114): every pin of a chat, newest first, with jump and
 * (for managers) unpin. Opened from the banner's List button, the header
 * menu, and the chat/topic info panels. A retracted original reads "Message
 * deleted" once the client has seen the retraction.
 */
export function PinsPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const store = useChatStore();
  const storeApi = useChatStoreApi();
  const [jumpError, setJumpError] = useState('');
  const [unpinError, setUnpinError] = useState('');
  const [unpinningId, setUnpinningId] = useState<string | undefined>(undefined);

  const chat = store.chats.find((entry) => entry.id === chatId);
  const pins = store.pins(chatId);
  const managers = store.canPin(chatId);

  const jump = (pin: PinRow): void => {
    setJumpError('');
    storeApi
      .getState()
      .openAtMessage(chatId, pin.messageId)
      .then(() => {
        onClose();
        window.requestAnimationFrame(() => {
          document
            .querySelector(`[data-message-id="${CSS.escape(pin.messageId)}"]`)
            ?.scrollIntoView({ block: 'center' });
        });
      })
      .catch(() => {
        setJumpError('Message not found');
      });
  };

  const unpin = (pin: PinRow): void => {
    setUnpinningId(pin.id);
    setUnpinError('');
    storeApi
      .getState()
      .unpinMessage(chatId, pin.id)
      .catch(() => {
        setUnpinError('Could not unpin. Try again.');
      })
      .finally(() => {
        setUnpinningId(undefined);
      });
  };

  return (
    <Sheet open onClose={onClose} ariaLabel={`Pinned messages in ${chat?.title ?? 'this chat'}`}>
      <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
        <Pin className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold">Pinned messages</div>
          <p className="text-[13px] text-muted-foreground">
            {pins.length === 0
              ? 'Nothing pinned yet'
              : `${pins.length} ${pins.length === 1 ? 'pin' : 'pins'}`}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Close pinned messages"
          onClick={onClose}
          className="shrink-0 rounded-full text-muted-foreground"
        >
          <X className="size-5" aria-hidden="true" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4">
        {pins.length === 0 && (
          <p className="px-2 text-[13px] text-muted-foreground">
            Pin an important message from its menu to keep it at the top.
          </p>
        )}
        {pins.map((pin) => {
          const loaded = store.messages(chatId).find((item) => item.id === pin.messageId);
          const deleted = loaded?.deleted === true;
          const snapshot = deleted ? 'Message deleted' : pin.text;
          return (
            <div
              key={pin.id}
              className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
            >
              <button
                type="button"
                onClick={() => jump(pin)}
                aria-label={`Jump to pinned message from ${pin.senderName}`}
                className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <div className="truncate text-[14px] font-semibold">{pin.senderName}</div>
                <div className="line-clamp-2 text-[13px] text-muted-foreground">
                  {snapshot !== '' ? (
                    <LinkText text={snapshot} />
                  ) : (
                    <span className="italic">{KIND_LABEL[pin.kind]}</span>
                  )}
                </div>
              </button>
              {managers && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Unpin message from ${pin.senderName}`}
                  className="shrink-0"
                  disabled={unpinningId === pin.id}
                  onClick={() => unpin(pin)}
                >
                  {unpinningId === pin.id ? 'Unpinning…' : 'Unpin'}
                </Button>
              )}
            </div>
          );
        })}
        {jumpError !== '' && (
          <p role="alert" className="px-2 text-[13px] text-danger">
            {jumpError}
          </p>
        )}
        {unpinError !== '' && (
          <p role="alert" className="px-2 text-[13px] text-danger">
            {unpinError}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/** A "Pinned messages" row for the chat/topic info panels (T-0114). */
export function PinsSection({ chatId, onOpen }: { chatId: string; onOpen: () => void }) {
  const store = useChatStore();
  const count = store.pins(chatId).length;
  return (
    <section aria-label="Pinned messages" className="flex flex-col gap-1 px-2">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open pinned messages, ${count} pinned`}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] hover:bg-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Pin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1">Pinned messages</span>
        <span className="font-mono text-[12px] text-muted-foreground">{count}</span>
      </button>
    </section>
  );
}
