import type { XmppElement } from '@xmpp/client';
import { ForwardOriginSchema, isValid, type ForwardOrigin } from '@zilar/protocol';
import { bareJid } from '../jid';
import {
  CORRECTION_NAMESPACE,
  DELAY_NAMESPACE,
  FALLBACK_NAMESPACE,
  REACTIONS_NAMESPACE,
  REFERENCE_NAMESPACE,
  REPLY_NAMESPACE,
  RETRACTION_NAMESPACE,
  STANZA_ID_NAMESPACE,
  ZILAR_FORWARD_NAMESPACE,
} from '../namespaces';
import type { Mention, MessageCorrection, MessageReactions, MessageRetraction } from '../types';
import type { ParseContext } from './parse-context';
import {
  MAX_MENTIONS,
  codePointLength,
  sanitizeReactions,
  utf16Offset,
  type ReplyRef,
} from './reactions';

export function timestamp(
  stanza: XmppElement,
  forwardedDelay: string | undefined,
  ctx: ParseContext,
): Date {
  const stamp = stanza.getChild('delay', DELAY_NAMESPACE)?.attrs['stamp'] ?? forwardedDelay;
  if (stamp !== undefined) {
    const date = new Date(stamp);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return ctx.now();
}

export function parseReply(stanza: XmppElement): (ReplyRef & { text?: string }) | undefined {
  const reply = stanza.getChild('reply', REPLY_NAMESPACE);
  const id = reply?.attrs['id'];
  if (reply === undefined || id === undefined) return undefined;
  const to = reply.attrs['to'];
  const text = replyFallbackText(stanza);
  return {
    id,
    ...(to === undefined ? {} : { to }),
    ...(text === undefined ? {} : { text }),
  };
}

// XEP-0461 backs a reply with an XEP-0428 fallback: the quoted text is the
// head of the body, marked by a `<fallback for="urn:xmpp:reply:0"><body
// start end/></fallback>` range. It is lifted here (bounds-checked like a
// mention) so the quote still shows when the replied-to message is not loaded.
function replyFallbackRange(stanza: XmppElement): { start: number; end: number } | undefined {
  const fallback = stanza.getChild('fallback', FALLBACK_NAMESPACE);
  if (fallback === undefined || fallback.attrs['for'] !== REPLY_NAMESPACE) return undefined;
  const range = fallback.getChild('body');
  const start = parseOffset(range?.attrs['start']);
  const end = parseOffset(range?.attrs['end']);
  if (start === undefined || end === undefined || start >= end) return undefined;
  return { start, end };
}

function replyFallbackText(stanza: XmppElement): string | undefined {
  const body = stanza.getChild('body')?.text();
  if (body === undefined) return undefined;
  const range = replyFallbackRange(stanza);
  if (range === undefined || range.end > codePointLength(body)) return undefined;
  const quote = Array.from(body).slice(range.start, range.end).join('');
  return quote === '' ? undefined : quote;
}

// XEP-0461: removes the fallback quote line from the body. The range names
// the quoted text (start and end are code points, bounds-checked as
// `replyFallbackText` does); the `> ` marker before it and the trailing
// newline go with it, so what is left is the reply text. A body that was
// only the quote comes back empty; anything without a usable range comes
// back unchanged.
export function stripReplyFallback(body: string, stanza: XmppElement): string {
  const range = replyFallbackRange(stanza);
  if (range === undefined || range.end > codePointLength(body)) return body;
  const rest = Array.from(body).slice(range.end).join('');
  return rest.startsWith('\n') ? rest.slice(1) : rest;
}

// XEP-0372: the URI is `xmpp:<bare-jid>`. Anything else is ignored. The bare
// JID loses its resource and any query and is lowercased for a stable key.
function mentionJidFromUri(uri: string | undefined): string | undefined {
  if (uri === undefined || !uri.startsWith('xmpp:')) return undefined;
  const rest = uri.slice('xmpp:'.length).split('?')[0] ?? '';
  const bare = bareJid(rest).toLowerCase();
  return /^[^@\s/]+@[^@\s/]+$/.test(bare) ? bare : undefined;
}

function parseOffset(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

// Fills the mentions of a message from its XEP-0372 references. Only
// `type="mention"` references with an `xmpp:` bare JID count; an offset that is
// missing, reversed or outside the body is dropped while the JID is kept.
export function parseMentions(
  stanza: XmppElement,
  body: string | undefined,
): Mention[] | undefined {
  const references = stanza.getChildren('reference', REFERENCE_NAMESPACE);
  if (references.length === 0) return undefined;

  const length = body === undefined ? 0 : codePointLength(body);
  const mentions: Mention[] = [];
  for (const reference of references) {
    if (mentions.length >= MAX_MENTIONS) break;
    if (reference.attrs['type'] !== 'mention') continue;
    const jid = mentionJidFromUri(reference.attrs['uri']);
    if (jid === undefined) continue;

    const mention: Mention = { jid };
    if (body !== undefined) {
      const begin = parseOffset(reference.attrs['begin']);
      const end = parseOffset(reference.attrs['end']);
      if (begin !== undefined && end !== undefined && begin < end && end <= length) {
        mention.begin = utf16Offset(body, begin);
        mention.end = utf16Offset(body, end);
      }
    }
    mentions.push(mention);
  }
  return mentions.length === 0 ? undefined : mentions;
}

// XEP-0444: a `reactions` element names the target and lists the reactor's
// complete current set. Invalid reactions are dropped and the set is capped;
// an element with no reactions clears the set. Without a target id it is
// ignored.
export function parseReactions(stanza: XmppElement): MessageReactions | undefined {
  const element = stanza.getChild('reactions', REACTIONS_NAMESPACE);
  if (element === undefined) return undefined;
  const targetId = element.attrs['id'];
  if (targetId === undefined || targetId === '') return undefined;
  const emojis = sanitizeReactions(
    element.getChildren('reaction').map((reaction) => reaction.text().trim()),
  );
  return { targetId, emojis };
}

// XEP-0308: a `<replace/>` names the corrected message by its sender-generated
// id. A missing or empty id is ignored.
export function parseCorrection(stanza: XmppElement): MessageCorrection | undefined {
  const replace = stanza.getChild('replace', CORRECTION_NAMESPACE);
  const targetId = replace?.attrs['id'];
  if (replace === undefined || targetId === undefined || targetId === '') return undefined;
  return { targetId };
}

// XEP-0424: a `<retract/>` names the retracted message. A missing or empty id
// is ignored. The retraction's fallback body is never a message body.
export function parseRetraction(stanza: XmppElement): MessageRetraction | undefined {
  const retract = stanza.getChild('retract', RETRACTION_NAMESPACE);
  const targetId = retract?.attrs['id'];
  if (retract === undefined || targetId === undefined || targetId === '') return undefined;
  return { targetId };
}

// A Zilar forward origin. A malformed element (a missing sender or name, a bad
// `at`, or a `<chat>` missing one of its parts) is dropped so the message still
// decodes without it; this path never throws.
export function parseForward(stanza: XmppElement): ForwardOrigin | undefined {
  const element = stanza.getChild('forward', ZILAR_FORWARD_NAMESPACE);
  if (element === undefined) return undefined;
  const chat = element.getChild('chat');
  const candidate = {
    sender_id: element.attrs['sender'],
    sender_name: element.getChildText('name'),
    chat_id: chat?.attrs['jid'],
    chat_name: chat?.attrs['name'],
    original_id: element.attrs['id'],
    original_at: element.attrs['at'],
  };
  return isValid(ForwardOriginSchema)(candidate) ? candidate : undefined;
}

// The id the sender generated: its `<origin-id/>` (XEP-0359) when present, else
// the stanza's `id` attribute. Used to name the original in an edit.
export function originIdOf(stanza: XmppElement): string | undefined {
  const origin = stanza.getChild('origin-id', STANZA_ID_NAMESPACE)?.attrs['id'];
  if (origin !== undefined && origin !== '') return origin;
  const id = stanza.attrs['id'];
  return id === undefined || id === '' ? undefined : id;
}
