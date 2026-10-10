// Pins of a chat, shared by both stores: loading the list, and pinning or
// unpinning a message optimistically with a rollback and one fixed error text
// per operation (R13). Where the pins and their errors live differs per store
// (web: atoms, mobile: a closure), so a small `PinsStore` adapter keeps the
// behaviour in one place while each store binds it to its own state.
import { Cause, Effect, Exit } from 'effect';
import type { Pin, PinKind } from '@zilar/api-contract';
import { fromPromise, type CoreCtx } from './ctx';

/** The one pin failure text (web's; both apps use it, Q4/R13). */
export const PIN_ERROR = 'Could not pin the message. Try again.';
/** The one unpin failure text (web's; both apps use it, Q4/R13). */
export const UNPIN_ERROR = 'Could not unpin the message. Try again.';
/** The loud pins-load failure text (mobile's; web loads pins silently). */
export const PINS_LOAD_ERROR = 'Could not load pins. Try again.';

/** The display-only snapshot the server stores for one pinned message. */
export interface PinMessageInput {
  readonly chat: string;
  readonly messageId: string;
  readonly senderName: string;
  readonly text: string;
  readonly kind: PinKind;
}

/** The pins API both apps' clients satisfy. */
export interface PinsApi {
  listPins(chat: string): Promise<readonly Pin[]>;
  pinMessage(input: PinMessageInput): Promise<Pin>;
  /** Web answers nothing, mobile echoes the removed row. */
  unpinMessage(id: string): Promise<void | { readonly id: string }>;
}

/** One pins error, shown inline under the chat. */
export interface PinsError {
  readonly chatId: string;
  readonly message: string;
}

/** Where one store keeps its pins and the viewer id. */
export interface PinsStore {
  pins(chatId: string): readonly Pin[];
  publish(chatId: string, pins: readonly Pin[]): void;
  /** Marks the chat's pins as loaded (web's `pinsReady`; mobile has no flag). */
  markReady(chatId: string): void;
  setError(error: PinsError | undefined): void;
  currentUserId(): string;
}

/** The message fields a pin snapshot reads; both apps' `UiMessage` satisfy it. */
export interface PinSource {
  readonly id: string;
  readonly senderName: string;
  readonly text?: string | undefined;
  readonly deleted?: boolean | undefined;
  readonly image?: unknown;
  readonly voice?: unknown;
  readonly card?: unknown;
  readonly attachment?: { readonly kind?: string | undefined } | undefined;
}

/** The kind of a pin snapshot, from the message's payload (web's precedence). */
export function pinKindFor(
  message: Pick<PinSource, 'image' | 'voice' | 'card' | 'attachment'>,
): PinKind {
  if (message.voice !== undefined) {
    return 'voice';
  }
  if (message.image !== undefined || message.attachment?.kind === 'image') {
    return 'image';
  }
  if (message.attachment !== undefined) {
    return 'file';
  }
  if (message.card !== undefined) {
    return 'card';
  }
  return 'text';
}

/** The display-only text of a pin: the message text, or empty for a payload. */
export function pinTextFor(message: Pick<PinSource, 'text' | 'deleted'>, kind: PinKind): string {
  if (message.deleted === true) {
    return 'Message deleted';
  }
  return kind === 'text' ? (message.text ?? '').slice(0, 300) : '';
}

/** The snapshot the server stores for a pin of `message`. */
export function pinSnapshotFor(chatId: string, message: PinSource): PinMessageInput {
  const kind = pinKindFor(message);
  return {
    chat: chatId,
    messageId: message.id,
    senderName: message.senderName.slice(0, 80) || 'Someone',
    text: pinTextFor(message, kind),
    kind,
  };
}

const isRemovedPin = (value: void | { readonly id: string }): value is { readonly id: string } =>
  typeof value === 'object' && value !== null && typeof value.id === 'string';

/** Loads the pins of `chatId`; a failure is silent unless `loud`. */
export function loadPins(
  _ctx: CoreCtx,
  api: PinsApi,
  store: PinsStore,
  chatId: string,
  loud: boolean,
): Effect.Effect<void, never> {
  return fromPromise(() => api.listPins(chatId)).pipe(
    Effect.flatMap((pins) =>
      Effect.sync(() => {
        store.publish(chatId, pins);
        store.markReady(chatId);
      }),
    ),
    Effect.catchCause(() =>
      Effect.sync(() => {
        if (loud) {
          store.setError({ chatId, message: PINS_LOAD_ERROR });
        }
      }),
    ),
  );
}

/** Pins a loaded message: the pin shows at once and is replaced by the saved one. */
export function pinMessage(
  ctx: CoreCtx,
  api: PinsApi,
  store: PinsStore,
  chatId: string,
  messageId: string,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const message = ctx.k
      .listFor(ctx.get(), chatId)
      .find((item) => ctx.k.sameMessage(item.id, messageId));
    if (message === undefined) {
      return yield* Effect.fail(new Error('Message not found'));
    }
    const snapshot = pinSnapshotFor(chatId, message);
    const before = store.pins(chatId);
    const optimistic: Pin = {
      ...snapshot,
      id: `pin-local-${message.id}`,
      pinnedBy: store.currentUserId(),
      pinnedAt: ctx.ports.now().toISOString(),
    };
    store.setError(undefined);
    store.publish(chatId, [optimistic, ...before]);
    const saved = yield* Effect.exit(fromPromise(() => api.pinMessage(snapshot)));
    if (Exit.isFailure(saved)) {
      store.publish(chatId, before);
      store.setError({ chatId, message: PIN_ERROR });
      return yield* Effect.fail(Cause.squash(saved.cause));
    }
    const current = store.pins(chatId);
    store.publish(
      chatId,
      current.some((pin) => pin.id === optimistic.id)
        ? current.map((pin) => (pin.id === optimistic.id ? saved.value : pin))
        : [saved.value, ...current.filter((pin) => pin.id !== optimistic.id)],
    );
  });
}

/** Unpins a message: the pin leaves at once and comes back if the server refuses. */
export function unpinMessage(
  _ctx: CoreCtx,
  api: PinsApi,
  store: PinsStore,
  chatId: string,
  pinId: string,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const before = store.pins(chatId);
    store.setError(undefined);
    store.publish(
      chatId,
      before.filter((pin) => pin.id !== pinId),
    );
    const removed = yield* Effect.exit(fromPromise(() => api.unpinMessage(pinId)));
    if (Exit.isFailure(removed)) {
      store.publish(chatId, before);
      store.setError({ chatId, message: UNPIN_ERROR });
      return yield* Effect.fail(Cause.squash(removed.cause));
    }
    // Mobile echoes the removed row; web answers nothing. Dropping the echo id
    // covers a pin the optimistic list did not know about; a same-id echo is
    // already gone, so nothing is republished in the common case.
    const echoed = removed.value;
    if (isRemovedPin(echoed) && echoed.id !== pinId) {
      store.publish(
        chatId,
        store.pins(chatId).filter((pin) => pin.id !== echoed.id),
      );
    }
  });
}
