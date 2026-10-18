import { Effect } from 'effect';
import {
  forwardedPayloadFor,
  forwardedUiFieldsFor,
  type AlbumRef,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import type { ForwardOrigin, Payload } from '@zilar/protocol';
import { ForwardOriginSchema, isValid } from '@zilar/protocol';
import { linkSent, nextLocalId, queueOutgoing, rememberMyAuthor } from './context';
import type { SendCtx } from './context';
import { fromPromise } from '../ctx';
import {
  armSendTimeout,
  isCurrentSendRun,
  newRun,
  settleFailure,
  settleSendTimeout,
} from './pipeline';
import { coreKind } from '../rows';
import { sendText } from './text';

// The room identity a forward may carry: only a public group or topic has a room JID
// safe to reveal. A private topic or group must omit both, so the target never learns a
// room it may not see.
function forwardPublicRoomFor(source: ChatSummary | undefined): ChatSummary | undefined {
  if (source === undefined || source.kind !== 'group') {
    return undefined;
  }
  const visibility = source.topic?.visibility ?? source.visibility;
  return visibility === 'public' ? source : undefined;
}

// The origin header of one forwarded copy. Reusing a message's own `forward` keeps the
// first author on a forward of a forward; otherwise it is built from the source, and a
// bad timestamp skips the message instead of putting junk on the wire.
function forwardOriginFor(ctx: SendCtx, message: UiMessage): ForwardOrigin | undefined {
  if (message.forward !== undefined) {
    return isValid(ForwardOriginSchema)(message.forward) ? message.forward : undefined;
  }
  const createdAt = message.createdAt.getTime();
  if (Number.isNaN(createdAt)) {
    return undefined;
  }
  const author = ctx.k.authorFor(message.id);
  const room = forwardPublicRoomFor(ctx.get().chats.find((entry) => entry.id === message.chatId));
  const originalId = ctx.k.correctionTargetFor(message.id);
  const candidate = {
    sender_id: author?.jid ?? message.senderId,
    sender_name: message.senderName,
    ...(room === undefined ? {} : { chat_id: room.id, chat_name: room.title }),
    ...(originalId === undefined ? {} : { original_id: originalId }),
    original_at: new Date(createdAt).toISOString(),
  };
  return isValid(ForwardOriginSchema)(candidate) ? candidate : undefined;
}

/**
 * A fresh album id. The web composer stamps one with `crypto.randomUUID()`; mobile
 * installs the same polyfill, so the forwards this module groups carry the same kind of
 * id the pick did.
 */
function newAlbumId(): string {
  return crypto.randomUUID();
}

/**
 * The album marker each forwarded copy carries. Copies that share a source `album.id`
 * and a sender are regrouped under one fresh id, with `index` and `count`; a copy that is
 * not part of a group of two or more gets no marker.
 */
function forwardedAlbumRefs(
  messages: readonly UiMessage[],
  id: () => string = newAlbumId,
): Map<UiMessage, AlbumRef> {
  const groups = new Map<string, UiMessage[]>();
  for (const message of messages) {
    if (message.album === undefined) {
      continue;
    }
    const key = `${message.album.id}\u0000${message.senderId}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [message]);
    } else {
      group.push(message);
    }
  }
  const refs = new Map<UiMessage, AlbumRef>();
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const albumId = id();
    group.forEach((message, index) => {
      refs.set(message, { id: albumId, index, count: group.length });
    });
  }
  return refs;
}

function runForwardSend(
  ctx: SendCtx,
  target: ChatSummary,
  localId: string,
  body: string,
  payload: Payload | undefined,
  origin: ForwardOrigin,
  album: AlbumRef | undefined,
): void {
  const current = ctx.core;
  if (current === undefined) {
    ctx.k.markSendFailed(target.id, localId, 'network');
    return;
  }
  const run = newRun();
  armSendTimeout(ctx, target.id, localId, run);
  ctx.rt.fork(
    fromPromise(() =>
      current.sendMessage(target.id, coreKind(target), body, {
        ...(payload === undefined ? {} : { payload }),
        forward: origin,
        ...(album === undefined ? {} : { album }),
      }),
    ).pipe(
      Effect.andThen((sent) =>
        Effect.sync(() => {
          linkSent(ctx, target, localId, sent.id);
          if (!isCurrentSendRun(ctx, localId, run)) {
            return;
          }
          settleSendTimeout(ctx, localId, run);
          ctx.k.updateMessageStatus(target.id, localId, 'sent');
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.sync(() => settleFailure(ctx, target.id, localId, run, cause)),
      ),
    ),
  );
}

export function forwardMessages(
  ctx: SendCtx,
  targets: string[],
  messages: UiMessage[],
  options?: { comment?: string },
): void {
  const comment = options?.comment?.trim();
  // The copies worth forwarding are picked once; any source album is regrouped per target
  // below. Grouping the sent copies keeps `count` equal to what actually arrives.
  const copies = messages.flatMap((message) => {
    if (
      message.deleted === true ||
      message.failed === true ||
      message.status === 'failed' ||
      message.status === 'sending'
    ) {
      return [];
    }
    const origin = forwardOriginFor(ctx, message);
    if (origin === undefined) {
      return [];
    }
    const payload = forwardedPayloadFor(message);
    const body = message.text ?? '';
    if (body.length === 0 && payload === undefined) {
      return [];
    }
    return [{ message, origin, payload, body }];
  });
  const visited = new Set<string>();
  for (const targetId of targets) {
    if (visited.has(targetId)) {
      continue;
    }
    visited.add(targetId);
    const target = ctx.get().chats.find((entry) => entry.id === targetId);
    if (target === undefined) {
      continue;
    }
    let queued = false;
    const albums = forwardedAlbumRefs(copies.map((copy) => copy.message));
    for (const { message, origin, payload, body } of copies) {
      const album = albums.get(message);
      const localId = nextLocalId(ctx);
      const copy: UiMessage = {
        id: localId,
        chatId: targetId,
        senderId: ctx.get().currentUserId,
        senderName: 'You',
        createdAt: ctx.ports.now(),
        status: 'sending',
        forward: origin,
        ...(body.length === 0 ? {} : { text: body }),
        ...(payload === undefined ? {} : forwardedUiFieldsFor(payload)),
        ...(album === undefined ? {} : { album }),
      };
      // Key the echo queue exactly as the matching normal send does, so the server echo
      // links to this bubble instead of duplicating it.
      const signature =
        payload !== undefined && payload.type === 'sticker'
          ? ctx.k.stickerSignatureFor(targetId, body, payload.data.sticker_id, undefined)
          : ctx.k.signatureFor(targetId, body, undefined);
      queueOutgoing(ctx, signature, localId);
      ctx.k.setChatMessage(targetId, copy, true);
      rememberMyAuthor(ctx, localId);
      if (body.length > 0) {
        ctx.k.rememberBaseText(localId, body);
      }
      queued = true;
      runForwardSend(ctx, target, localId, body, payload, origin, album);
    }
    // The comment is a separate normal text message, only when this target received at
    // least one copy.
    if (queued && comment !== undefined && comment.length > 0) {
      sendText(ctx, targetId, comment);
    }
  }
}
