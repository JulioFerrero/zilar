import type { XmppElement } from '@xmpp/client';
import { decodePayload, type Payload } from '@zilar/protocol';
import { bareJid, normalizeJid } from './jid';
import {
  AGENT_NAMESPACE,
  CHAT_MARKERS_NAMESPACE,
  CHAT_STATES_NAMESPACE,
  DELIVERED_NAMESPACE,
  ROSTER_NAMESPACE,
} from './namespaces';
import type { DeliveredMarkEvent } from './types-delivered';
import type {
  ChatKind,
  ChatMessage,
  DisplayedEvent,
  Mention,
  RosterEvent,
  RosterSubscription,
  TypingEvent,
} from './types';
import { parseAlbum } from './stanza/album';
import { MAX_STATUS_CHARS } from './stanza/build-control';
import {
  parseCorrection,
  parseForward,
  parseMentions,
  parseReactions,
  parseRetraction,
  parseReply,
  stripReplyFallback,
  timestamp,
  originIdOf,
} from './stanza/parse-fields';
import { domainAllowed, messageKind, mucUserItem, occupantIdOf } from './stanza/parse-presence';
import {
  unwrapMessage,
  type DecodedStanza,
  type ParseContext,
  type SenderResolution,
} from './stanza/parse-context';
import { conversationJid, fromNick, messageId, resolveSender } from './stanza/resolve-sender';
import { CHAT_STATES } from './stanza/reactions';

export * from './stanza/build-outgoing';
export * from './stanza/build-control';

export {
  isMamResult,
  mamResultQueryId,
  stanzaErrorCondition,
  type ParseContext,
  type DecodedStanza,
  type MucPresence,
  type SenderResolution,
} from './stanza/parse-context';

export {
  occupantIdOf,
  parseMucPresence,
  parseContactPresence,
  parseDirectInvitation,
} from './stanza/parse-presence';

export type RosterPush = {
  id: string;
  from?: string;
  /** True when the push came from our own server (no `from`, our JID or domain). */
  trusted: boolean;
  items: RosterEvent[];
};

const ROSTER_SUBSCRIPTIONS: ReadonlyArray<RosterSubscription> = [
  'none',
  'to',
  'from',
  'both',
  'remove',
];

function parseRosterEvent(item: XmppElement): RosterEvent | undefined {
  const jid = item.attrs['jid'];
  if (jid === undefined || jid === '') return undefined;
  const raw = item.attrs['subscription'];
  const subscription = ROSTER_SUBSCRIPTIONS.includes(raw as RosterSubscription)
    ? (raw as RosterSubscription)
    : 'none';
  const event: RosterEvent = { jid: bareJid(jid), subscription };
  const name = item.attrs['name'];
  if (name !== undefined && name !== '') event.name = name;
  return event;
}

// RFC 6121 §2.1.6: a roster push comes from our own server (no `from`), our own bare JID
// or our domain; anything else is a spoof and is answered with an error.
export function parseRosterPush(
  stanza: XmppElement,
  domain: string,
  me: string | undefined,
): RosterPush | undefined {
  if (!stanza.is('iq') || stanza.attrs['type'] !== 'set') return undefined;
  const query = stanza.getChild('query', ROSTER_NAMESPACE);
  if (query === undefined) return undefined;
  const id = stanza.attrs['id'];
  if (id === undefined || id === '') return undefined;

  const from = stanza.attrs['from'];
  const push: RosterPush = {
    id,
    trusted: isTrustedRosterFrom(from, domain, me),
    items: query
      .getChildren('item')
      .map((item) => parseRosterEvent(item))
      .filter((event): event is RosterEvent => event !== undefined),
  };
  if (from !== undefined) push.from = from;
  return push;
}

function isTrustedRosterFrom(
  from: string | undefined,
  domain: string,
  me: string | undefined,
): boolean {
  if (from === undefined) return true;
  const bare = bareJid(from);
  return bare === domain || (me !== undefined && bare === me);
}

export {
  parseReactions,
  parseCorrection,
  parseRetraction,
  parseForward,
  originIdOf,
} from './stanza/parse-fields';

// Message bodies are text that can be large. Anything above 64 KiB of UTF-8 is
// truncated on a code point boundary so a hostile peer cannot exhaust memory.
export const MAX_BODY_BYTES = 64 * 1024;

function utf8Size(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    bytes += utf8Size(character.codePointAt(0) ?? 0);
  }
  return bytes;
}

export function capBody(body: string): string {
  if (utf8ByteLength(body) <= MAX_BODY_BYTES) {
    return body;
  }

  let bytes = 0;
  let end = 0;
  for (const character of body) {
    const size = utf8Size(character.codePointAt(0) ?? 0);
    if (bytes + size > MAX_BODY_BYTES) {
      break;
    }
    bytes += size;
    end += character.length;
  }
  return body.slice(0, end);
}

// `types.ts` has a line cap, so this field joins `ChatMessage` as a module augmentation.
declare module './types' {
  interface ChatMessage {
    /**
     * The MAM `<result id>`: this user's archive id, present only when fetched from the
     * archive. Kept apart from `id`, which may resolve to a `<stanza-id>` instead, which a
     * pin stored under the archive id may not match later.
     */
    archiveId?: string;
  }
}

export function decodeMessageStanza(stanza: XmppElement, ctx: ParseContext): DecodedStanza {
  const envelope = unwrapMessage(stanza, ctx);
  const inner = envelope.inner;
  const deliveredMark = parseDeliveredMark(inner, ctx.me);
  const kind = messageKind(inner);
  const from = inner.attrs['from'];
  if (kind === undefined || from === undefined || !domainAllowed(from, kind, ctx)) {
    return deliveredMark === undefined ? {} : { deliveredMark };
  }

  const decoded: DecodedStanza = {};
  if (deliveredMark !== undefined) decoded.deliveredMark = deliveredMark;

  const roomJid = bareJid(from);
  const sender = resolveSender({
    kind,
    from,
    itemJid: mucUserItem(inner)?.attrs['jid'],
    archived: envelope.archived,
    occupantId: occupantIdOf(inner),
    me: ctx.me,
    myNick: kind === 'groupchat' ? ctx.myNickFor?.(roomJid) : undefined,
    roster: kind === 'groupchat' ? ctx.rosterFor?.(roomJid) : undefined,
  });
  const chatJid = conversationJid(inner, from, kind, ctx.me);

  const correction = parseCorrection(inner);
  const retraction = parseRetraction(inner);

  const bodyElement = inner.getChild('body');
  // A retraction's fallback body is for clients without XEP-0424; it is not this text.
  const wireBody =
    retraction !== undefined || bodyElement === undefined ? undefined : capBody(bodyElement.text());
  // A XEP-0461 reply fallback quotes the replied-to text as a leading "> …" line; it
  // leaves the decoded body, so a reply carrying only the quote has no body.
  const strippedBody = wireBody === undefined ? undefined : stripReplyFallback(wireBody, inner);
  const body = strippedBody === '' ? undefined : strippedBody;

  const agent = inner.getChild('agent', AGENT_NAMESPACE);
  let payload: Payload | undefined;
  if (agent !== undefined) {
    const result = decodePayload(agent.text());
    if (result.ok) {
      payload = result.payload;
    }
  }

  const reactions = parseReactions(inner);

  const album = parseAlbum(inner);

  const forward = parseForward(inner);

  if (
    body !== undefined ||
    payload !== undefined ||
    reactions !== undefined ||
    correction !== undefined ||
    retraction !== undefined
  ) {
    const message: ChatMessage = {
      id: messageId(inner, envelope.archiveId, kind, chatJid, ctx.me),
      chatJid,
      kind,
      fromJid: sender.jid,
      fromResolved: sender.resolved,
      timestamp: timestamp(
        inner,
        envelope.forwardedDelay,
        ctx,
        !envelope.forwarded && kind === 'chat',
      ),
      outgoing: sender.outgoing,
    };
    const originId = originIdOf(inner);
    if (originId !== undefined) message.originId = originId;
    if (envelope.archiveId !== undefined) message.archiveId = envelope.archiveId;
    if (sender.occupantId !== undefined) message.occupantId = sender.occupantId;
    if (body !== undefined) message.body = body;
    if (payload !== undefined) message.payload = payload;
    if (album !== undefined) message.album = album;
    if (forward !== undefined) message.forward = forward;
    if (reactions !== undefined) message.reactions = reactions;
    if (correction !== undefined) message.correction = correction;
    if (retraction !== undefined) message.retraction = retraction;
    if (kind === 'groupchat') {
      const nick = fromNick(inner, from, kind);
      if (nick !== undefined) message.fromNick = nick;
    }
    const replyTo = parseReply(inner);
    if (replyTo !== undefined) message.replyTo = replyTo;
    // XEP-0372 offsets count from the wire body, so they are parsed against it, then
    // moved past the stripped fallback prefix into the decoded body.
    const wireMentions =
      wireBody === undefined || body === undefined ? undefined : parseMentions(inner, wireBody);
    const mentions = shiftMentionsPastReply(wireMentions, wireBody, body);
    if (mentions !== undefined) message.mentions = mentions;
    decoded.message = message;
  }

  const typing = parseTyping(inner, kind, from, ctx, sender);
  if (typing !== undefined) decoded.typing = typing;

  const displayed = parseDisplayed(inner, kind, from, ctx, sender);
  if (displayed !== undefined) decoded.displayed = displayed;

  return decoded;
}

// A mention that pointed into the stripped quote keeps its JID and loses its offsets.
function shiftMentionsPastReply(
  mentions: Mention[] | undefined,
  wireBody: string | undefined,
  body: string | undefined,
): Mention[] | undefined {
  if (mentions === undefined || wireBody === undefined || body === undefined) return mentions;
  const shift = wireBody.length - body.length;
  if (shift === 0) return mentions;
  return mentions.map((mention) => {
    if (mention.begin === undefined || mention.end === undefined) return mention;
    const begin = mention.begin - shift;
    const end = mention.end - shift;
    if (begin < 0 || begin >= end || end > body.length) {
      return { jid: mention.jid };
    }
    return { jid: mention.jid, begin, end };
  });
}

function parseTyping(
  stanza: XmppElement,
  kind: ChatKind,
  from: string,
  ctx: ParseContext,
  sender: SenderResolution,
): TypingEvent | undefined {
  const state = CHAT_STATES.find(
    (candidate) => stanza.getChild(candidate, CHAT_STATES_NAMESPACE) !== undefined,
  );
  if (state === undefined) return undefined;
  const stage = stanza.getChild('stage', AGENT_NAMESPACE)?.text();
  const status =
    stage === undefined || stage === ''
      ? undefined
      : Array.from(stage).slice(0, MAX_STATUS_CHARS).join('');
  return {
    chatJid: conversationJid(stanza, from, kind, ctx.me),
    fromJid: sender.jid,
    state,
    ...(status === undefined ? {} : { status }),
    outgoing: sender.outgoing,
  };
}

function parseDisplayed(
  stanza: XmppElement,
  kind: ChatKind,
  from: string,
  ctx: ParseContext,
  sender: SenderResolution,
): DisplayedEvent | undefined {
  const displayed = stanza.getChild('displayed', CHAT_MARKERS_NAMESPACE);
  const messageId = displayed?.attrs['id'];
  if (displayed === undefined || messageId === undefined) return undefined;
  return {
    chatJid: conversationJid(stanza, from, kind, ctx.me),
    fromJid: sender.jid,
    messageId,
    outgoing: sender.outgoing,
  };
}

// The live delivered notice: a bodiless headline from my own bare JID. Trusted only
// when the `from` bare JID is exactly mine, so no one can move my ticks.
function parseDeliveredMark(
  stanza: XmppElement,
  me: string | undefined,
): DeliveredMarkEvent | undefined {
  if (me === undefined || stanza.attrs['type'] !== 'headline') return undefined;
  const from = stanza.attrs['from'];
  if (from === undefined || normalizeJid(from) !== normalizeJid(me)) return undefined;
  const delivered = stanza.getChild('delivered', DELIVERED_NAMESPACE);
  const chat = delivered?.attrs['chat'];
  const until = delivered?.attrs['until'];
  if (chat === undefined || chat === '' || until === undefined || until === '') {
    return undefined;
  }
  return { chatJid: bareJid(chat), until };
}
