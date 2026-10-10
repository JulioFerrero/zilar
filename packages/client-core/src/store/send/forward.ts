import { Effect } from 'effect';
import {
  forwardedPayloadFor,
  forwardedUiFieldsFor,
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

// The room identity a forward may carry (T-0414): only a public group or
// topic has a room JID safe to reveal. A DM/AI chat has no room JID, and a
// private topic (or private group) must omit both so the target never learns a
// room it may not see (forwarding plan §3.1/§3.6).
function forwardPublicRoomFor(source: ChatSummary | undefined): ChatSummary | undefined {
  if (source === undefined || source.kind !== 'group') {
    return undefined;
  }
  const visibility = source.topic?.visibility ?? source.visibility;
  return visibility === 'public' ? source : undefined;
}

// The origin header of one forwarded copy. Reusing a message's own `forward`
// keeps the first author on a forward of a forward. Otherwise it is built from
// the source message; `ForwardOriginSchema` caps over-long names and rejects a
// bad timestamp, and such a message is skipped instead of putting junk on the
// wire.
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

// One forwarded copy's send: the same deadline/status machinery as voice and
// attachments, with a fixed user-safe reason on failure.
function runForwardSend(
  ctx: SendCtx,
  target: ChatSummary,
  localId: string,
  body: string,
  payload: Payload | undefined,
  origin: ForwardOrigin,
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
    for (const message of messages) {
      if (
        message.deleted === true ||
        message.failed === true ||
        message.status === 'failed' ||
        message.status === 'sending'
      ) {
        continue;
      }
      const origin = forwardOriginFor(ctx, message);
      if (origin === undefined) {
        continue;
      }
      const payload = forwardedPayloadFor(message);
      const body = message.text ?? '';
      if (body.length === 0 && payload === undefined) {
        continue;
      }
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
      };
      // Key the echo queue exactly as the matching normal send does, so the
      // server echo links to this bubble instead of duplicating it.
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
      runForwardSend(ctx, target, localId, body, payload, origin);
    }
    // The comment is a separate normal text message, only when this target
    // received at least one copy.
    if (queued && comment !== undefined && comment.length > 0) {
      sendText(ctx, targetId, comment);
    }
  }
}
