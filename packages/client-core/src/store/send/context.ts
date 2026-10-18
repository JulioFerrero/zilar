import type { Deferred } from 'effect';
import type { AlbumRef, ChatSummary, ReplyRef, UiMention } from '@zilar/chat-core';
import type { CoreCtx } from '../ctx';
import type { CorePorts, SendPorts } from '../ports';

export interface SendRun {
  readonly settled: Deferred.Deferred<void>;
}

/** What one send call needs: the core context, the send ports and the memory kept
 * beside the state (the sequence, open runs and retry bytes). */
export interface SendCtx extends CoreCtx {
  readonly ports: CorePorts & SendPorts;
  sequence: number;
  readonly sendRuns: Map<string, SendRun>;
  readonly pendingAttachments: Map<string, unknown>;
  readonly pendingVoices: Map<string, unknown>;
  /** Texts waiting for their ack or resend (F4), memory only; lives on the core context
   * the apps create with the store. */
  readonly outbox?: import('./outbox').TextOutbox | undefined;
  /** Whether a plain text send passes no options at all (`undefined`, mobile) instead of
   * an empty object (`{}`, web, the default). */
  readonly omitEmptyTextOptions?: boolean | undefined;
}

export interface SendTextOptions {
  readonly replyTo?: ReplyRef | undefined;
  readonly mentions?: readonly UiMention[] | undefined;
}

export interface SendAttachmentOptions {
  readonly caption?: string | undefined;
  readonly replyTo?: ReplyRef | undefined;
  readonly album?: AlbumRef | undefined;
}

export interface SendStickerInput {
  readonly stickerId: string;
  readonly packId: string;
  readonly url: string;
  readonly emoji?: string | undefined;
  readonly width: number;
  readonly height: number;
  readonly mime: 'image/webp' | 'image/png';
}

const nextLocalId = (ctx: SendCtx): string => {
  ctx.sequence += 1;
  return `local-${ctx.sequence}`;
};

// A reply names the id both sides share: the wire id (the origin id in a DM, the room
// stanza-id in a group), falling back to the local id when it is not known yet.
function wireReply(ctx: SendCtx, replyTo: ReplyRef | undefined): ReplyRef | undefined {
  return replyTo === undefined
    ? undefined
    : { ...replyTo, id: ctx.k.wireTargetFor(replyTo.id) ?? replyTo.id };
}

const queueOutgoing = (ctx: SendCtx, signature: string, localId: string): void => {
  const queue = ctx.pendingOutgoing.get(signature) ?? [];
  queue.push(localId);
  ctx.pendingOutgoing.set(signature, queue);
};

const rememberMyAuthor = (ctx: SendCtx, localId: string): void => {
  const mine = ctx.k.myJid();
  if (mine !== undefined) {
    ctx.k.rememberAuthor(localId, { jid: mine, resolved: true });
  }
};

// A later validated send clears this chat's stale error banner; web and mobile
// share the rule.
function clearActionError(ctx: SendCtx, chatId: string): void {
  ctx.set((state) => ({
    actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
  }));
}

// The upload progress of one message: web has no progress UI and ignores the port's
// callback, so this only ever writes on mobile. `clear` is a no-op without progress.
function setUploadProgress(
  ctx: SendCtx,
  chatId: string,
  messageId: string,
  progress: number,
): void {
  ctx.set((state) => ({
    messagesByChat: {
      ...state.messagesByChat,
      [chatId]: ctx.k
        .listFor(state, chatId)
        .map((item) =>
          ctx.k.sameMessage(item.id, messageId)
            ? { ...item, uploadProgress: Math.min(1, Math.max(0, progress)) }
            : item,
        ),
    },
  }));
}

function clearUploadProgress(ctx: SendCtx, chatId: string, messageId: string): void {
  const current = ctx.k
    .listFor(ctx.get(), chatId)
    .find((item) => ctx.k.sameMessage(item.id, messageId));
  if (current?.uploadProgress === undefined) {
    return;
  }
  ctx.set((state) => ({
    messagesByChat: {
      ...state.messagesByChat,
      [chatId]: ctx.k.listFor(state, chatId).map((item) => {
        if (!ctx.k.sameMessage(item.id, messageId)) {
          return item;
        }
        const next = { ...item };
        delete next.uploadProgress;
        return next;
      }),
    },
  }));
}

// What a successful stanza send changes: the ids are linked even when a retry owns the
// message now. In a group, a stanza id the echo already filed stays the wire target.
const linkSent = (ctx: SendCtx, chat: ChatSummary, localId: string, serverId: string): void => {
  ctx.k.linkMessageIds(localId, serverId);
  ctx.k.linkAckToServer(chat, localId, serverId);
  ctx.k.rememberOriginId(localId, serverId);
};

export {
  clearActionError,
  clearUploadProgress,
  linkSent,
  nextLocalId,
  queueOutgoing,
  rememberMyAuthor,
  setUploadProgress,
  wireReply,
};
