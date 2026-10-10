import { Effect } from 'effect';
import type { ChatSummary, ReplyRef, UiMessage } from '@zilar/chat-core';
import { mentionsForTrimmedText } from '@zilar/chat-core';
import { sendTyping } from '@zilar/client-core/store';
import { StickerSchema, isValid, type ForwardOrigin, type Payload } from '@zilar/protocol';

import { attachmentDataFor, MAX_ATTACHMENT_BYTES } from '../../lib/attachments';
import type { PickedFile } from '../../lib/attachment-ports';
import type { ConvertedVoice, RecordedVoice } from '../../lib/voice';
import { validateRecording, voiceSendRefusalMessage } from '../../lib/voice';
import { voiceFailureReasonFor } from '../../lib/voice-native';
import type { MobileMessage } from '../../lib/types';
import type { ChatStoreState } from '../types';
import { lift, orElse, recover, type StoreCtx } from './runtime';

export type Send = Pick<
  ChatStoreState,
  | 'sendTyping'
  | 'sendText'
  | 'sendSticker'
  | 'forwardMessages'
  | 'retrySticker'
  | 'sendAttachment'
  | 'retryAttachment'
  | 'cancelAttachment'
  | 'sendVoice'
  | 'retryVoice'
  | 'cancelVoice'
>;

/**
 * Everything the user sends: text, stickers, forwards, attachments and voice
 * messages, and the Retry and cancel of the ones that fail. Each send is a
 * fiber of the session; a rejected send marks only its own bubble failed.
 * The text send has no timeout of its own (the XMPP core owns it), so there
 * is nothing for `timeoutOrElse` to take over.
 */
export function makeSend(ctx: StoreCtx): Send {
  const { ports, get, set, s, h } = ctx;
  const { pendingOutgoing, pendingUploads, pendingVoices } = s;
  let sequence = 0;

  function nextLocalId(): string {
    sequence += 1;
    return `local-${sequence}`;
  }

  // The echo queue: the optimistic id waits under the signature the server
  // echo will match, so the echo links to its bubble instead of duplicating it.
  function enqueue(signature: string, localId: string): void {
    const queue = pendingOutgoing.get(signature) ?? [];
    queue.push(localId);
    pendingOutgoing.set(signature, queue);
  }

  function rememberOwnMessage(localId: string): void {
    const mine = h.myJid();
    if (mine !== undefined) {
      h.rememberAuthor(localId, { jid: mine, resolved: true });
    }
  }

  // A later validated send clears this chat's stale error banner.
  function clearActionError(chatId: string): void {
    set((state) => ({
      actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
    }));
  }

  // The server acknowledged a send: the optimistic id and the server id are
  // the same message from now on.
  function acknowledge(chat: ChatSummary, localId: string, serverId: string): void {
    h.linkMessageIds(localId, serverId);
    h.linkAckToServer(chat, localId, serverId);
    h.rememberOriginId(localId, serverId);
    h.updateMessageStatus(chat.id, localId, 'sent');
  }

  const messageAliveIn =
    (chatId: string, localId: string): (() => boolean) =>
    () =>
      h.listFor(get(), chatId).some((item) => h.sameMessage(item.id, localId));

  // The upload steps of an attachment, re-runnable from a Retry: ask the
  // chat's XMPP session for a XEP-0363 slot, PUT the bytes with the slot's
  // headers, then send the payload message exactly as web does. The kept
  // bytes stay until the stanza send succeeds, so a Retry after a failed
  // send still has them; they are dropped only then (and on cancel). A
  // 'cancelled' error is swallowed only when this very message was
  // cancelled by the user (the bubble is already gone); any other abort
  // marks the message failed so Retry appears.
  function runAttachmentUpload(
    chat: ChatSummary,
    localId: string,
    file: PickedFile,
    caption: string,
    replyTo: ReplyRef | undefined,
  ): void {
    const current = s.core;
    if (current === undefined) {
      h.markAttachmentFailed(chat.id, localId);
      return;
    }
    const uploader = ports.uploader;
    if (uploader === undefined) {
      // No uploader injected (tests inject a fake; the app injects the
      // expo-file-system one): fail loudly instead of hanging a bubble in
      // "sending" forever.
      h.markAttachmentFailed(chat.id, localId);
      return;
    }
    const messageAlive = messageAliveIn(chat.id, localId);
    ctx.forkSession(
      recover(
        Effect.gen(function* () {
          const contentType = file.mimeType === '' ? 'application/octet-stream' : file.mimeType;
          // Unknown size: the slot API needs an exact byte count, so stat
          // once more right before the request; a still-unknown size fails
          // the send like any other upload failure (Retry stays available).
          const statSize = ports.statSize;
          const size =
            file.size !== undefined
              ? file.size
              : statSize === undefined
                ? undefined
                : yield* lift(() => statSize(file.uri));
          if (size === undefined) {
            h.markAttachmentFailed(chat.id, localId);
            return;
          }
          const slot = yield* lift(() =>
            current.requestUploadSlot({
              filename: attachmentDataFor(file, '').name,
              size,
              contentType,
            }),
          );
          // A cancel during the slot round-trip removes the bubble: stop
          // here and send nothing.
          if (!messageAlive()) {
            return;
          }
          yield* lift(() =>
            uploader.upload(
              file,
              { putUrl: slot.putUrl, headers: slot.headers },
              (fraction) => h.setUploadProgress(chat.id, localId, fraction),
              localId,
            ),
          );
          if (!messageAlive()) {
            return;
          }
          const data = attachmentDataFor(file, slot.getUrl);
          h.updateMessageAttachment(chat.id, localId, data);
          h.clearUploadProgress(chat.id, localId);
          const sent = yield* lift(() =>
            current.sendMessage(chat.id, h.coreKind(chat), caption, {
              payload: { v: 0, type: 'attachment', data },
              ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
            }),
          );
          if (!messageAlive()) {
            return;
          }
          pendingUploads.delete(localId);
          h.linkMessageIds(localId, sent.id);
          h.linkAckToServer(chat, localId, sent.id);
          h.rememberOriginId(localId, sent.id);
          h.updateMessageStatus(chat.id, localId, 'sent');
        }),
        (error) =>
          Effect.sync(() => {
            h.clearUploadProgress(chat.id, localId);
            // Keep the local bytes so the bubble can offer a Retry. A cancel
            // removes the bubble first (see `cancelAttachment`); a 'cancelled'
            // error for a message that is already gone is that cancel landing,
            // so it stays silent. Any other abort means the upload itself
            // failed and Retry must appear.
            if (error instanceof Error && error.message === 'cancelled' && !messageAlive()) {
              return;
            }
            if (messageAlive()) {
              h.markAttachmentFailed(chat.id, localId);
            }
          }),
      ),
    );
  }

  // The voice pipeline (T-0154), re-runnable from a Retry: convert (skipped
  // for m4a), PUT the bytes through the XEP-0363 slot, then send the `voice`
  // payload message exactly as web does. The recording stays in
  // `pendingVoices` until the stanza send succeeds, so a Retry after a
  // failed send re-runs the same pipeline from the kept file. A
  // 'cancelled' error is swallowed only when this very message was
  // cancelled by the user (the bubble is already gone); any other failure
  // marks the message failed so Retry appears.
  function runVoiceSend(
    chat: ChatSummary,
    localId: string,
    recording: RecordedVoice,
    waveform: number[],
    replyTo: ReplyRef | undefined,
  ): void {
    const current = s.core;
    if (current === undefined) {
      h.markVoiceFailed(chat.id, localId, 'network');
      return;
    }
    const messageAlive = messageAliveIn(chat.id, localId);
    ctx.forkSession(
      recover(
        Effect.gen(function* () {
          const converted: ConvertedVoice = yield* lift(() => ports.voice().convert(recording));
          if (!messageAlive()) {
            return;
          }
          const url = yield* lift(() =>
            ports
              .voice()
              .upload(
                current,
                converted,
                (fraction) => h.setUploadProgress(chat.id, localId, fraction),
                localId,
              ),
          );
          if (!messageAlive()) {
            return;
          }
          const voice = {
            duration_ms: converted.durationMs,
            mime: 'audio/mp4',
            waveform,
            url,
          };
          h.updateMessageVoice(chat.id, localId, voice);
          h.clearUploadProgress(chat.id, localId);
          const sent = yield* lift(() =>
            current.sendMessage(chat.id, h.coreKind(chat), '', {
              payload: { v: 0, type: 'voice', data: voice },
              ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
            }),
          );
          if (!messageAlive()) {
            return;
          }
          pendingVoices.delete(localId);
          pendingVoices.delete(h.aliasRoot(localId));
          h.linkMessageIds(localId, sent.id);
          h.linkAckToServer(chat, localId, sent.id);
          h.rememberOriginId(localId, sent.id);
          h.updateMessageStatus(chat.id, localId, 'sent');
        }),
        (error) =>
          Effect.sync(() => {
            h.clearUploadProgress(chat.id, localId);
            if (error instanceof Error && error.message === 'cancelled' && !messageAlive()) {
              return;
            }
            if (messageAlive()) {
              h.markVoiceFailed(
                chat.id,
                localId,
                voiceFailureReasonFor(error, get().status !== 'online'),
              );
            }
          }),
      ),
    );
  }

  // The send step of a sticker, re-runnable from a Retry: the payload is
  // already on the optimistic message, so only the stanza is (re)sent.
  function runStickerSend(
    chat: ChatSummary,
    localId: string,
    payload: Extract<Payload, { type: 'sticker' }>,
    body: string,
    replyTo: ReplyRef | undefined,
  ): void {
    const current = s.core;
    if (current === undefined) {
      h.markStickerFailed(chat.id, localId);
      return;
    }
    ctx.forkSession(
      recover(
        lift(() =>
          current.sendMessage(chat.id, h.coreKind(chat), body, {
            payload,
            ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
          }),
        ).pipe(Effect.flatMap((sent) => Effect.sync(() => acknowledge(chat, localId, sent.id)))),
        () => Effect.sync(() => h.markStickerFailed(chat.id, localId)),
      ),
    );
  }

  // One forwarded copy's send, in the `runStickerSend` shape: mobile has no
  // send-timeout machinery, so a rejected send marks only this copy failed.
  function runForwardSend(
    target: ChatSummary,
    localId: string,
    body: string,
    payload: Payload | undefined,
    origin: ForwardOrigin,
  ): void {
    const current = s.core;
    if (current === undefined) {
      h.markStickerFailed(target.id, localId);
      return;
    }
    ctx.forkSession(
      recover(
        lift(() =>
          current.sendMessage(target.id, h.coreKind(target), body, {
            ...(payload === undefined ? {} : { payload }),
            forward: origin,
          }),
        ).pipe(Effect.flatMap((sent) => Effect.sync(() => acknowledge(target, localId, sent.id)))),
        () => Effect.sync(() => h.markStickerFailed(target.id, localId)),
      ),
    );
  }

  return {
    sendTyping: (chatId) => sendTyping(ctx.coreCtx, chatId),
    sendText: (chatId, text, options) => {
      const trimmed = text.trim();
      const chat = get().chats.find((entry) => entry.id === chatId);
      if (trimmed.length === 0 || chat === undefined) {
        return;
      }
      const mentions = mentionsForTrimmedText(text, trimmed, options?.mentions ?? []);
      const localId = nextLocalId();
      const replyTo = options?.replyTo;
      const message: UiMessage = {
        id: localId,
        chatId,
        senderId: get().currentUserId,
        senderName: 'You',
        text: trimmed,
        createdAt: ports.now(),
        status: 'sending',
        ...(mentions.length === 0 ? {} : { mentions }),
        ...(replyTo === undefined ? {} : { replyTo }),
      };
      enqueue(h.signatureFor(chatId, trimmed, replyTo), localId);
      h.setChatMessage(chatId, message, true);
      rememberOwnMessage(localId);

      const current = s.core;
      if (current === undefined) {
        return;
      }
      // The message stays marked as sending when the send fails; a reconnect
      // can resend later.
      ctx.forkSession(
        orElse(
          lift(() =>
            current.sendMessage(
              chatId,
              h.coreKind(chat),
              trimmed,
              mentions.length === 0 && replyTo === undefined
                ? undefined
                : {
                    ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
                    ...(mentions.length === 0
                      ? {}
                      : {
                          mentions: mentions.map((mention) => ({
                            jid: mention.jid,
                            begin: mention.begin,
                            end: mention.end,
                          })),
                        }),
                  },
            ),
          ).pipe(Effect.flatMap((sent) => Effect.sync(() => acknowledge(chat, localId, sent.id)))),
          undefined,
        ),
      );
    },
    sendSticker: (chatId, sticker, options) => {
      const chat = get().chats.find((entry) => entry.id === chatId);
      if (chat === undefined) {
        return;
      }
      // The choice may come from tampered storage recents or drifted pack
      // rows: validate before the optimistic insert, because `encodePayload`
      // throws synchronously on an invalid payload and would otherwise leave
      // a stuck `sending` bubble with no retry.
      const data = {
        pack_id: sticker.packId,
        sticker_id: sticker.stickerId,
        url: sticker.url,
        ...(sticker.emoji === undefined ? {} : { emoji: sticker.emoji }),
        width: sticker.width,
        height: sticker.height,
        mime: sticker.mime,
      };
      if (!isValid(StickerSchema)(data)) {
        set({ actionError: { chatId, message: 'That sticker could not be sent.' } });
        return;
      }
      const localId = nextLocalId();
      const replyTo = options?.replyTo;
      const body = sticker.emoji ?? '';
      const payload = { v: 0, type: 'sticker', data } as const;
      const message: UiMessage = {
        id: localId,
        chatId,
        senderId: get().currentUserId,
        senderName: 'You',
        text: body,
        createdAt: ports.now(),
        status: 'sending',
        card: payload,
        ...(replyTo === undefined ? {} : { replyTo }),
      };
      enqueue(h.stickerSignatureFor(chatId, body, sticker.stickerId, replyTo), localId);
      clearActionError(chatId);
      h.setChatMessage(chatId, message, true);
      rememberOwnMessage(localId);
      runStickerSend(chat, localId, payload, body, replyTo);
    },
    forwardMessages: (targets, messages, options) => {
      const comment = options?.comment?.trim();
      const visited = new Set<string>();
      for (const targetId of targets) {
        if (visited.has(targetId)) {
          continue;
        }
        visited.add(targetId);
        const target = get().chats.find((entry) => entry.id === targetId);
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
          const origin = h.forwardOriginFor(message);
          if (origin === undefined) {
            continue;
          }
          const payload = h.forwardedPayloadFor(message);
          const body = message.text ?? '';
          if (body.length === 0 && payload === undefined) {
            continue;
          }
          const localId = nextLocalId();
          const copy: UiMessage = {
            id: localId,
            chatId: targetId,
            senderId: get().currentUserId,
            senderName: 'You',
            createdAt: ports.now(),
            status: 'sending',
            forward: origin,
            ...(body.length === 0 ? {} : { text: body }),
            ...(payload === undefined ? {} : h.forwardedUiFieldsFor(payload)),
          };
          // Key the echo queue exactly as the matching normal send does, so
          // the server echo links to this bubble instead of duplicating it.
          const signature =
            payload !== undefined && payload.type === 'sticker'
              ? h.stickerSignatureFor(targetId, body, payload.data.sticker_id, undefined)
              : h.signatureFor(targetId, body, undefined);
          enqueue(signature, localId);
          h.setChatMessage(targetId, copy, true);
          rememberOwnMessage(localId);
          queued = true;
          runForwardSend(target, localId, body, payload, origin);
        }
        // The comment is a separate normal text message, only when this
        // target received at least one copy.
        if (queued && comment !== undefined && comment.length > 0) {
          get().sendText(targetId, comment);
        }
      }
    },
    retrySticker: (chatId, messageId) => {
      const chat = get().chats.find((entry) => entry.id === chatId);
      if (chat === undefined) {
        return;
      }
      const message = h.listFor(get(), chatId).find((item) => h.sameMessage(item.id, messageId));
      const payload =
        message?.card !== undefined && message.card.type === 'sticker' ? message.card : undefined;
      if (message === undefined || payload === undefined) {
        return;
      }
      if (!isValid(StickerSchema)(payload.data)) {
        h.markStickerFailed(chatId, messageId);
        return;
      }
      set((state) => ({
        // A later validated send clears this chat's stale error banner.
        actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: h
            .listFor(state, chatId)
            .map((item) => (h.sameMessage(item.id, messageId) ? h.clearFailure(item) : item)),
        },
      }));
      // Enqueue the id under the sticker signature so the server echo
      // reconciles with this bubble instead of duplicating it (a retry
      // without the enqueue keeps the local row AND appends the echo).
      enqueue(
        h.stickerSignatureFor(chatId, message.text ?? '', payload.data.sticker_id, message.replyTo),
        messageId,
      );
      runStickerSend(chat, messageId, payload, message.text ?? '', message.replyTo);
    },
    sendAttachment: (chatId, file, options) => {
      const chat = get().chats.find((entry) => entry.id === chatId);
      if (chat === undefined) {
        return;
      }
      // An empty or oversized file is refused inline, before any request,
      // exactly like web's composer. The cap follows the server upload
      // limit (50 MiB); a refused slot still fails on Retry with the same
      // message. Only a REAL zero says "That file is empty": an unknown
      // size (undefined) is never refused as empty — the upload decides.
      if (file.size !== undefined && file.size === 0) {
        set({ actionError: { chatId, message: 'That file is empty.' } });
        return;
      }
      if (file.size !== undefined && file.size > MAX_ATTACHMENT_BYTES) {
        set({ actionError: { chatId, message: 'That file is larger than 50 MB.' } });
        return;
      }
      const localId = nextLocalId();
      const replyTo = options?.replyTo;
      const caption = options?.caption?.trim() ?? '';
      const kind = attachmentDataFor(file, '').kind;
      const localUrl = kind === 'image' ? file.uri : '';
      const message: UiMessage = {
        id: localId,
        chatId,
        senderId: get().currentUserId,
        senderName: 'You',
        createdAt: ports.now(),
        status: 'sending',
        attachment: attachmentDataFor(file, localUrl),
        ...(caption.length === 0 ? {} : { text: caption }),
        ...(replyTo === undefined ? {} : { replyTo }),
      };
      // The local preview URI rides alongside (never on the wire): the
      // bubble shows the local bytes while the upload runs.
      (message as Partial<MobileMessage>).localUri = file.uri;
      enqueue(h.signatureFor(chatId, caption, replyTo), localId);
      clearActionError(chatId);
      h.setChatMessage(chatId, message, true);
      pendingUploads.set(localId, file);
      rememberOwnMessage(localId);
      runAttachmentUpload(chat, localId, file, caption, replyTo);
    },
    retryAttachment: (chatId, messageId) => {
      const root = h.aliasRoot(messageId);
      const file = pendingUploads.get(root) ?? pendingUploads.get(messageId);
      const chat = get().chats.find((entry) => entry.id === chatId);
      if (file === undefined || chat === undefined) {
        return;
      }
      const message = h.listFor(get(), chatId).find((item) => h.sameMessage(item.id, messageId));
      if (message === undefined) {
        return;
      }
      h.clearAttachmentFailure(chatId, messageId);
      // The retry re-keys the local preview (a retried message keeps the
      // local URI) and re-runs the upload from the kept bytes.
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: h
            .listFor(state, chatId)
            .map((item) =>
              h.sameMessage(item.id, messageId) ? { ...item, localUri: file.uri } : item,
            ),
        },
      }));
      runAttachmentUpload(chat, messageId, file, message.text ?? '', message.replyTo);
    },
    cancelAttachment: (chatId, messageId) => {
      // Cancelling aborts only this message's in-flight PUT and removes
      // the optimistic bubble, like web's composer cancel. The bytes are
      // dropped, so a later Retry is a no-op. Other messages' uploads keep
      // running: the uploader keys controllers per message id.
      ports.uploader?.cancel(h.aliasRoot(messageId));
      ports.uploader?.cancel(messageId);
      pendingUploads.delete(h.aliasRoot(messageId));
      pendingUploads.delete(messageId);
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: h.listFor(state, chatId).filter((item) => !h.sameMessage(item.id, messageId)),
        },
      }));
    },
    sendVoice: (chatId, recording, options) => {
      const chat = get().chats.find((entry) => entry.id === chatId);
      if (chat === undefined) {
        return;
      }
      // The send boundary (finding 1, review round 2): refuse an
      // over-limit recording here too, before any optimistic bubble, slot
      // request or PUT — the composer is not the only caller. The banner
      // names the actual refusal (finding 4, round 3), never a guess.
      const refusal = Effect.runSync(
        Effect.try({ try: () => validateRecording(recording), catch: (error) => error }).pipe(
          Effect.as(undefined),
          Effect.catch((error) => Effect.succeed({ error })),
        ),
      );
      if (refusal !== undefined) {
        set({ actionError: { chatId, message: voiceSendRefusalMessage(refusal.error) } });
        return;
      }
      const durationMs = Math.max(1, Math.round(recording.durationMs));
      const waveform = recording.waveform.length > 0 ? recording.waveform : [12];
      const localId = nextLocalId();
      const replyTo = options?.replyTo;
      const kept: RecordedVoice = {
        uri: recording.uri,
        mimeType: recording.mimeType,
        size: recording.size,
        durationMs,
      };
      const message: UiMessage = {
        id: localId,
        chatId,
        senderId: get().currentUserId,
        senderName: 'You',
        createdAt: ports.now(),
        status: 'sending',
        voice: {
          duration_ms: durationMs,
          mime: 'audio/mp4',
          waveform,
          ...(recording.uri === '' ? {} : { url: recording.uri }),
        },
        ...(replyTo === undefined ? {} : { replyTo }),
      };
      // The local file URI rides alongside (never on the wire): the bubble
      // plays the local bytes while the upload runs.
      (message as Partial<MobileMessage>).localUri = recording.uri;
      enqueue(h.signatureFor(chatId, '', replyTo), localId);
      clearActionError(chatId);
      h.setChatMessage(chatId, message, true);
      pendingVoices.set(localId, kept);
      rememberOwnMessage(localId);
      runVoiceSend(chat, localId, kept, waveform, replyTo);
    },
    retryVoice: (chatId, messageId) => {
      const root = h.aliasRoot(messageId);
      const kept = pendingVoices.get(root) ?? pendingVoices.get(messageId);
      const chat = get().chats.find((entry) => entry.id === chatId);
      if (kept === undefined || chat === undefined) {
        return;
      }
      const message = h.listFor(get(), chatId).find((item) => h.sameMessage(item.id, messageId));
      if (message === undefined || message.voice === undefined || message.failed !== true) {
        return;
      }
      h.clearAttachmentFailure(chatId, messageId);
      // The retry re-keys the local preview and re-runs the pipeline from
      // the kept recording.
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: h
            .listFor(state, chatId)
            .map((item) =>
              h.sameMessage(item.id, messageId) ? { ...item, localUri: kept.uri } : item,
            ),
        },
      }));
      runVoiceSend(chat, messageId, kept, message.voice.waveform, message.replyTo);
    },
    cancelVoice: (chatId, messageId) => {
      // Cancelling aborts only this message's in-flight PUT and removes
      // the optimistic bubble. The recording is dropped, so a later Retry
      // is a no-op. The uploader keys controllers per message id.
      ports.uploader?.cancel(h.aliasRoot(messageId));
      ports.uploader?.cancel(messageId);
      pendingVoices.delete(h.aliasRoot(messageId));
      pendingVoices.delete(messageId);
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: h.listFor(state, chatId).filter((item) => !h.sameMessage(item.id, messageId)),
        },
      }));
    },
  };
}
