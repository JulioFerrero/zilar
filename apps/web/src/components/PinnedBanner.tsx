import { Pin } from 'lucide-react';
import { useState } from 'react';
import { LinkText } from './LinkText';
import { cn } from '@/lib/utils';
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
 * The pinned-message banner under the chat header (T-0114, decision D28): a
 * slim 2-line-max well with the sender and the snapshot text (or a kind
 * label for attachments). Clicking the text jumps to the message — scrolling
 * when it is loaded, paging back through history when it is not. With
 * several pins the banner cycles ("1 of N"); the list button opens the pins
 * panel. A retracted original whose retraction the client has seen reads
 * "Message deleted", and a manager can unpin it from the panel. Pin/unpin
 * failures surface here with a dismiss key.
 */
export function PinnedBanner({ chatId }: { chatId: string }) {
  const store = useChatStore();
  const storeApi = useChatStoreApi();
  const pins = store.pins(chatId);
  const pinsError = store.pinsError?.chatId === chatId ? store.pinsError : undefined;
  const [index, setIndex] = useState(0);
  const [jumpError, setJumpError] = useState('');

  if (pins.length === 0) {
    return pinsError === undefined ? null : (
      <div className="shrink-0 border-b border-divider bg-panel px-3 pt-2 pb-2">
        <div className="mx-auto flex w-full max-w-[860px] items-center gap-2 px-1">
          <p role="alert" className="flex-1 text-[12px] text-danger">
            {pinsError.message}
          </p>
          <button
            type="button"
            aria-label="Dismiss pins error"
            onClick={() => storeApi.getState().dismissPinsError()}
            className="shrink-0 rounded-full px-2 py-0.5 text-[12px] text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }
  const current = pins[Math.min(index, pins.length - 1)] ?? pins[0]!;
  const loaded = store.messages(chatId).find((item) => item.id === current.messageId);
  const deleted = loaded?.deleted === true;
  const snapshot = deleted ? 'Message deleted' : current.text;

  const cycle = (): void => {
    setJumpError('');
    setIndex((value) => (value + 1) % pins.length);
  };

  const jump = (): void => {
    setJumpError('');
    storeApi
      .getState()
      .openAtMessage(chatId, current.messageId)
      .then(() => {
        // The message is loaded now: bring its bubble into view. The list
        // renders every message with `data-message-id`.
        window.requestAnimationFrame(() => {
          document
            .querySelector(`[data-message-id="${CSS.escape(current.messageId)}"]`)
            ?.scrollIntoView({ block: 'center' });
        });
      })
      .catch(() => {
        setJumpError('Message not found');
      });
  };

  return (
    <div className="shrink-0 border-b border-divider bg-panel px-3 pt-2 pb-2">
      <div className="well-surface mx-auto flex w-full max-w-[860px] items-center gap-2 rounded-[12px] px-3 py-2">
        <Pin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <button
          type="button"
          onClick={jump}
          aria-label={`Jump to pinned message from ${current.senderName}`}
          className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <span className="block truncate text-[13px] leading-5 font-semibold text-foreground">
            {current.senderName}
          </span>
          <span className="block max-h-10 overflow-hidden text-[13px] leading-5 text-ellipsis text-muted-foreground">
            {snapshot !== '' ? (
              <LinkText text={snapshot} />
            ) : (
              <span className="italic">{KIND_LABEL[current.kind]}</span>
            )}
          </span>
        </button>
        {pins.length > 1 && (
          <button
            type="button"
            onClick={cycle}
            aria-label={`Show next pinned message, ${Math.min(index, pins.length - 1) + 1} of ${pins.length}`}
            className="shrink-0 rounded-full px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {Math.min(index, pins.length - 1) + 1} of {pins.length}
          </button>
        )}
        <button
          type="button"
          onClick={() => storeApi.getState().setPinsPanel(chatId)}
          aria-label={`Open pinned messages, ${pins.length} pinned`}
          className="shrink-0 rounded-full px-2 py-1 text-[13px] font-medium text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          List
        </button>
      </div>
      {jumpError !== '' && (
        <p
          role="alert"
          className={cn('mx-auto w-full max-w-[860px] px-1 pt-1 text-[12px] text-danger')}
        >
          {jumpError}
        </p>
      )}
      {pinsError !== undefined && (
        <div className="mx-auto flex w-full max-w-[860px] items-center gap-2 px-1 pt-1">
          <p role="alert" className="flex-1 text-[12px] text-danger">
            {pinsError.message}
          </p>
          <button
            type="button"
            aria-label="Dismiss pins error"
            onClick={() => storeApi.getState().dismissPinsError()}
            className="shrink-0 rounded-full px-2 py-0.5 text-[12px] text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
