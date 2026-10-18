import type { Deferred } from 'effect';
import type { AlbumRef, ChatSummary, ReplyRef, UiMention } from '@zilar/chat-core';
import type { CoreCtx } from '../ctx';
import type { CorePorts, SendPorts } from '../ports';

/** One send attempt of a message; `settled` completes when the attempt is over. */
export interface SendRun {
  readonly settled: Deferred.Deferred<void>;
}

/** What one send call needs: the core context, the send ports and the memory
 * the pipeline keeps beside the state (its sequence, the open runs and the
 * bytes kept for a Retry). */
export interface SendCtx extends CoreCtx {
  readonly ports: CorePorts & SendPorts;
  /** The counter behind the optimistic `local-N` ids. */
  sequence: number;
  /** The current send attempt of a message, by its alias root. */
  readonly sendRuns: Map<string, SendRun>;
  /** An outgoing attachment's bytes, kept for a Retry after a failed upload. */
  readonly pendingAttachments: Map<string, unknown>;
  /** An outgoing voice recording's bytes, kept for a Retry after a failed send. */
  readonly pendingVoices: Map<string, unknown>;
  /** Texts waiting for their ack or their resend (F4, `send/outbox.ts`);
   * memory only. Lives on the core context the apps create with the store. */
  readonly outbox?: import('./outbox').TextOutbox | undefined;
  /** Whether a plain text send (no reply, no mentions) passes no options at all
   * (`undefined`, mobile) instead of an empty object (`{}`, web, the default). */
  readonly omitEmptyTextOptions?: boolean | undefined;
}

export interface SendTextOptions {
  readonly replyTo?: ReplyRef | undefined;
  readonly mentions?: readonly UiMention[] | undefined;
}

export interface SendAttachmentOptions {
  readonly caption?: string | undefined;
  readonly replyTo?: ReplyRef | undefined;
  /** Album membership (`urn:zilar:album:0`) for a photo sent as part of a pick. */
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

// A reply names the id both sides share: the wire id the reactions path already
// computes (the origin id in a DM, the room stanza-id in a group), falling back
// to the local id when it is not known yet.
function wireReply(ctx: SendCtx, replyTo: ReplyRef | undefined): ReplyRef | undefined {
  return replyTo === undefined
    ? undefined
    : { ...replyTo, id: ctx.k.wireTargetFor(replyTo.id) ?? replyTo.id };
}

// Queues the optimistic id under the signature the server echo will carry.
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

// A later validated send clears this chat's stale error banner (R20): mobile's
// rule, now shared so web does it too.
function clearActionError(ctx: SendCtx, chatId: string): void {
  ctx.set((state) => ({
    actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
  }));
}

// The upload progress of one message (T-0150, moved from mobile's store in T10):
// web has no progress UI and ignores the port's `onProgress`, so this only ever
// writes on mobile. `clear` is a no-op when the message carries no progress.
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

// What a stanza send that succeeded changes: the ids are linked even when a
// retry owns the message now. In a group, a stanza id the echo already filed
// stays the wire target (`linkAckToServer`).
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
