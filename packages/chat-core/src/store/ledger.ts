import type { Payload } from '@zilar/protocol';
import { AttachmentSchema, PayloadSchema, VoiceMetaSchema, isValid } from '@zilar/protocol';
import { summarize, type ReactionsState } from '../reactions';
import type { UiMention, UiMessage, UiReaction } from '../types';

// The reused payload of a forwarded message: a sticker or other card as-is,
// an attachment or voice rebuilt from the UiMessage fields. The voice
// transcript is dropped (it is chat-scoped). Every payload is validated with
// the protocol schema before the optimistic insert, like `sendSticker`.
export function forwardedPayloadFor(message: UiMessage): Payload | undefined {
  if (message.card !== undefined) {
    return isValid(PayloadSchema)(message.card) ? message.card : undefined;
  }
  if (message.attachment !== undefined) {
    const data = message.attachment;
    return isValid(AttachmentSchema)(data) ? { v: 0, type: 'attachment', data } : undefined;
  }
  if (message.voice !== undefined) {
    const { transcript: _transcript, ...data } = message.voice;
    return isValid(VoiceMetaSchema)(data) ? { v: 0, type: 'voice', data } : undefined;
  }
  return undefined;
}

// The content fields a forwarded payload paints into the optimistic bubble, so
// it looks like the echo the matching normal send would produce.
export function forwardedUiFieldsFor(
  payload: Payload,
): Pick<UiMessage, 'voice' | 'attachment' | 'card'> {
  if (payload.type === 'attachment') {
    return { attachment: payload.data };
  }
  if (payload.type === 'voice') {
    return { voice: payload.data };
  }
  return { card: payload };
}

// Two mentions are equal when their ids and ranges match, in order.
export function mentionsEqual(
  left: UiMention[] | undefined,
  right: UiMention[] | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      entry.jid === other.jid &&
      entry.begin === other.begin &&
      entry.end === other.end
    );
  });
}

export function reactionsEqual(
  left: UiReaction[] | undefined,
  right: UiReaction[] | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      entry.emoji === other.emoji &&
      entry.count === other.count &&
      entry.mine === other.mine &&
      entry.reactors.join('\u0000') === other.reactors.join('\u0000')
    );
  });
}

export type ReactionChipLookups = {
  readonly aliasRoot: (id: string) => string;
  readonly myJid: () => string | undefined;
  readonly reactorName: (chatId: string, reactorJid: string) => string;
};

// The chips of a message, from the stored reaction updates. The lookup is
// alias-aware: an optimistic id and the server id of the same message resolve
// to one target.
export function reactionChips(
  state: ReactionsState | undefined,
  chatId: string,
  messageId: string,
  lookups: ReactionChipLookups,
): UiReaction[] | undefined {
  if (state === undefined) {
    return undefined;
  }
  const summary = summarize(state, lookups.aliasRoot(messageId), lookups.myJid() ?? '');
  if (summary.length === 0) {
    return undefined;
  }
  return summary.map((entry) => ({
    emoji: entry.emoji,
    count: entry.count,
    mine: entry.mine,
    reactors: entry.reactors.map((reactor) => lookups.reactorName(chatId, reactor)),
  }));
}

// The localpart of a JID on our own domain, used only as a lookup key. It is
// never shown; the localpart of a user JID is the user id lowercased.
export function userLocalpartOf(mine: string | undefined, fromJid: string): string | undefined {
  if (mine === undefined) {
    return undefined;
  }
  const domain = mine.slice(mine.indexOf('@') + 1);
  const at = fromJid.indexOf('@');
  if (at === -1) {
    return undefined;
  }
  const local = fromJid.slice(0, at);
  const host = fromJid.slice(at + 1);
  return host === domain ? local.toLowerCase() : undefined;
}
