// Pins of a chat shared by both stores: loading, and pinning or unpinning optimistically
// with a rollback and one fixed error per operation. Where pins live differs per store, so
// a small `PinsStore` adapter keeps the behaviour in one place.
import { Cause, Effect, Exit } from 'effect';
import type { Pin, PinKind } from '@zilar/api-contract';
import { fromPromise, type CoreCtx } from './ctx';

export const PIN_ERROR = 'Could not pin the message. Try again.';
export const UNPIN_ERROR = 'Could not unpin the message. Try again.';
export const PINS_LOAD_ERROR = 'Could not load pins. Try again.';

export interface PinMessageInput {
  readonly chat: string;
  readonly messageId: string;
  readonly senderName: string;
  readonly text: string;
  readonly kind: PinKind;
}

export interface PinsApi {
  listPins(chat: string): Promise<readonly Pin[]>;
  pinMessage(input: PinMessageInput): Promise<Pin>;
  unpinMessage(id: string): Promise<void | { readonly id: string }>;
}

export interface PinsError {
  readonly chatId: string;
  readonly message: string;
}

export interface PinsStore {
  pins(chatId: string): readonly Pin[];
  publish(chatId: string, pins: readonly Pin[]): void;
  markReady(chatId: string): void;
  setError(error: PinsError | undefined): void;
  currentUserId(): string;
}

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

export function pinTextFor(message: Pick<PinSource, 'text' | 'deleted'>, kind: PinKind): string {
  if (message.deleted === true) {
    return 'Message deleted';
  }
  return kind === 'text' ? (message.text ?? '').slice(0, 300) : '';
}

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

/**
 * Applies the media-panel trust rule: an `image` or `gif` on an untrusted host loses its
 * `url`, so the panel never auto-loads it. With no trust function nothing is trusted;
 * `resolve` makes a server-relative url absolute before the check (native).
 */
export function sanitizeMediaItems<T extends { kind: string; url?: string | undefined }>(
  items: readonly T[],
  isTrusted: ((url: string) => boolean) | undefined,
  resolve?: (url: string) => string,
): T[] {
  return items.map((item): T => {
    const url = item.url === undefined ? undefined : (resolve?.(item.url) ?? item.url);
    const media = item.kind === 'image' || item.kind === 'gif';
    if (url === undefined || (media && isTrusted?.(url) !== true)) {
      const copy = { ...item };
      delete copy.url;
      return copy;
    }
    return url === item.url ? item : { ...item, url };
  });
}

const isRemovedPin = (value: void | { readonly id: string }): value is { readonly id: string } =>
  typeof value === 'object' && value !== null && typeof value.id === 'string';

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
    // Mobile echoes the removed row; web answers nothing. Dropping the echo id covers a pin
    // the optimistic list did not know about; a same-id echo is already gone.
    const echoed = removed.value;
    if (isRemovedPin(echoed) && echoed.id !== pinId) {
      store.publish(
        chatId,
        store.pins(chatId).filter((pin) => pin.id !== echoed.id),
      );
    }
  });
}
