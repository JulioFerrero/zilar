import { Effect } from 'effect';
import { Pin, X } from 'lucide-react';
import { useState } from 'react';
import { LinkText } from './LinkText';
import { Button } from './ui/button';
import { ListRow } from './ui/list-row';
import { Sheet } from './ui/sheet';
import type { Pin as PinRow } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { scrollToMessage } from '@/lib/scrollToMessage';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';

const KIND_LABEL: Record<PinRow['kind'], string> = {
  text: '',
  image: 'Photo',
  file: 'File',
  voice: 'Voice message',
  card: 'Card',
};

interface PinsPanelActions {
  /** Closes the panel once a jump has landed on the message. */
  readonly onOpened: () => void;
  readonly onJumpStart: () => void;
  readonly onJumpFailed: () => void;
  readonly onUnpinStart: (pin: PinRow) => void;
  readonly onUnpinFailed: () => void;
  readonly onUnpinSettled: (pinId: string) => void;
}

/**
 * The pins panel (T-0114): every pin of a chat, newest first, with jump and
 * (for managers) unpin. Opened from the banner's List button, the header
 * menu, and the chat/topic info panels. A retracted original reads "Message
 * deleted" once the client has seen the retraction.
 */
export function PinsPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const store = useChatStore();
  const [jumpFailed, setJumpFailed] = useState(false);
  const [unpinFailed, setUnpinFailed] = useState(false);
  // The store drops a pin as soon as its unpin starts. Its row stays mounted
  // (rendering nothing) until the unpin settles, so the row's action still
  // reports a failure after the pin has left the list.
  const [unpinning, setUnpinning] = useState<ReadonlyArray<PinRow>>([]);

  const chat = store.chats.find((entry) => entry.id === chatId);
  const pins = store.pins(chatId);
  const managers = store.canPin(chatId);
  const settling = unpinning.filter((pin) => !pins.some((entry) => entry.id === pin.id));

  const actions: PinsPanelActions = {
    onOpened: onClose,
    onJumpStart: () => setJumpFailed(false),
    onJumpFailed: () => setJumpFailed(true),
    onUnpinStart: (pin) => {
      setUnpinFailed(false);
      setUnpinning((list) => [...list.filter((entry) => entry.id !== pin.id), pin]);
    },
    onUnpinFailed: () => setUnpinFailed(true),
    onUnpinSettled: (pinId) => {
      setUnpinning((list) => list.filter((entry) => entry.id !== pinId));
    },
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
        {pins.map((pin) => (
          <PinRowItem
            key={pin.id}
            chatId={chatId}
            pin={pin}
            listed
            managers={managers}
            actions={actions}
          />
        ))}
        {settling.map((pin) => (
          <PinRowItem
            key={pin.id}
            chatId={chatId}
            pin={pin}
            listed={false}
            managers={managers}
            actions={actions}
          />
        ))}
        {jumpFailed && (
          <p role="alert" className="px-2 text-[13px] text-danger">
            Message not found
          </p>
        )}
        {unpinFailed && (
          <p role="alert" className="px-2 text-[13px] text-danger">
            Could not unpin. Try again.
          </p>
        )}
      </div>
    </Sheet>
  );
}

/**
 * One pin with its own jump and unpin actions, so two rows can run at once;
 * a second click on the same row waits for the first. A row whose pin is no
 * longer listed renders nothing, but stays mounted until its unpin settles.
 */
function PinRowItem({
  chatId,
  pin,
  listed,
  managers,
  actions,
}: {
  chatId: string;
  pin: PinRow;
  listed: boolean;
  managers: boolean;
  actions: PinsPanelActions;
}) {
  const store = useChatStore();
  const storeApi = useChatStoreApi();
  const [, jumpTo] = useAction((target: PinRow) =>
    fromApi(() => storeApi.getState().openAtMessage(chatId, target.messageId)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          actions.onOpened();
          window.requestAnimationFrame(() => {
            scrollToMessage(target.messageId);
          });
        }),
      ),
      Effect.tapError(() => Effect.sync(actions.onJumpFailed)),
    ),
  );
  const [unpinState, unpin] = useAction((target: PinRow) =>
    fromApi(() => storeApi.getState().unpinMessage(chatId, target.id)).pipe(
      Effect.tapError(() => Effect.sync(actions.onUnpinFailed)),
      Effect.ensuring(Effect.sync(() => actions.onUnpinSettled(target.id))),
    ),
  );
  if (!listed) {
    return null;
  }
  const loaded = store.messages(chatId).find((item) => item.id === pin.messageId);
  const deleted = loaded?.deleted === true;
  const snapshot = deleted ? 'Message deleted' : pin.text;
  const unpinBusy = isWaiting(unpinState);
  const startJump = (): void => {
    actions.onJumpStart();
    jumpTo(pin);
  };
  const startUnpin = (): void => {
    if (unpinBusy) {
      return;
    }
    actions.onUnpinStart(pin);
    unpin(pin);
  };
  return (
    <div className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover">
      <button
        type="button"
        onClick={startJump}
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
          disabled={unpinBusy}
          onClick={startUnpin}
        >
          {unpinBusy ? 'Unpinning…' : 'Unpin'}
        </Button>
      )}
    </div>
  );
}

/** A "Pinned messages" row for the chat/topic info panels (T-0114). */
export function PinsSection({ chatId, onOpen }: { chatId: string; onOpen: () => void }) {
  const store = useChatStore();
  const count = store.pins(chatId).length;
  return (
    <section aria-label="Pinned messages" className="flex flex-col gap-1 px-2">
      <ListRow
        icon={<Pin />}
        title="Pinned messages"
        trailing={String(count)}
        ariaLabel={`Open pinned messages, ${count} pinned`}
        onClick={onOpen}
      />
    </section>
  );
}
