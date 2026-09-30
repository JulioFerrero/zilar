import { Pin, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LinkText } from './LinkText';
import { Button } from './ui/button';
import { useMediaQuery } from '@/lib/useMediaQuery';
import type { Pin as PinRow } from '@/lib/api';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';

const KIND_LABEL: Record<PinRow['kind'], string> = {
  text: '',
  image: 'Photo',
  file: 'File',
  voice: 'Voice message',
  card: 'Card',
};

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The pins panel (T-0114): every pin of a chat, newest first, with jump and
 * (for managers) unpin. Opened from the banner's List button, the header
 * menu, and the chat/topic info panels. A retracted original reads "Message
 * deleted" once the client has seen the retraction.
 */
export function PinsPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const store = useChatStore();
  const storeApi = useChatStoreApi();
  const isWide = useMediaQuery('(min-width: 900px)');
  const panelRef = useRef<HTMLDivElement>(null);
  const [jumpError, setJumpError] = useState('');
  const [unpinError, setUnpinError] = useState('');
  const [unpinningId, setUnpinningId] = useState<string | undefined>(undefined);

  const chat = store.chats.find((entry) => entry.id === chatId);
  const pins = store.pins(chatId);
  const managers = store.canPin(chatId);

  // Esc closes the panel. Capture phase so it beats ChatShell's window
  // handler, like the topic panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // On a narrow layout the panel is the whole screen: keep Tab inside it.
  useEffect(() => {
    if (isWide) {
      return;
    }
    const root = panelRef.current;
    if (root === null) {
      return;
    }
    root.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, [isWide]);

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pinned messages in ${chat?.title ?? 'this chat'}`}
      onClick={onClose}
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full flex-col bg-surface shadow-xl outline-none sm:w-[380px]"
      >
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
          <button
            type="button"
            aria-label="Close pinned messages"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
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
                    disabled={unpinningId !== undefined}
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
      </div>
    </div>
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
