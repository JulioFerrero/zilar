import type { XmppElement } from '@xmpp/client';
import { decodePayload, type Payload } from '@zilar/protocol';
import { bareJid, normalizeJid } from '../jid';
import {
  AGENT_NAMESPACE,
  CHAT_MARKERS_NAMESPACE,
  CHAT_STATES_NAMESPACE,
  DELIVERED_NAMESPACE,
} from '../namespaces';
import { capBody } from '../text';
import type {
  ChatKind,
  ChatMessage,
  DeliveredMarkEvent,
  DisplayedEvent,
  Mention,
  TypingEvent,
} from '../types';
import { parseAlbum } from './album';
import { MAX_STATUS_CHARS } from './build-outgoing';
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
} from './parse-fields';
import { domainAllowed, messageKind, mucUserItem, occupantIdOf } from './parse-presence';
import {
  unwrapMessage,
  type DecodedStanza,
  type ParseContext,
  type SenderResolution,
} from './parse-context';
import { conversationJid, fromNick, messageId, resolveSender } from './resolve-sender';
import { CHAT_STATES } from './reactions';

export function decodeMessageStanza(stanza: XmppElement, ctx: ParseContext): DecodedStanza {
  const envelope = unwrapMessage(stanza);
  const inner = envelope.inner;
  // A delivered notice is a bodiless headline, which has no chat kind; parse it
  // before the kind guard so it is not dropped (T-1245).
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
    occupantId: occupantIdOf(inner),
    me: ctx.me,
    myNick: kind === 'groupchat' ? ctx.myNickFor?.(roomJid) : undefined,
    roster: kind === 'groupchat' ? ctx.rosterFor?.(roomJid) : undefined,
  });
  const chatJid = conversationJid(inner, from, kind, ctx.me);

  const correction = parseCorrection(inner);
  const retraction = parseRetraction(inner);

  const bodyElement = inner.getChild('body');
  // A retraction carries a fallback body for clients without XEP-0424 support:
  // it is not this message's text, so it is dropped.
  const wireBody =
    retraction !== undefined || bodyElement === undefined ? undefined : capBody(bodyElement.text());
  // A XEP-0461 reply fallback quotes the replied-to text as a leading "> …"
  // line; it belongs to the quote, not the message, so it leaves the decoded
  // body. A reply whose body was only the quote (a voice or sticker reply)
  // reads as a message with no body.
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
      timestamp: timestamp(inner, envelope.forwardedDelay, ctx),
      outgoing: sender.outgoing,
    };
    const originId = originIdOf(inner);
    if (originId !== undefined) message.originId = originId;
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
    // XEP-0372 offsets count from the wire body, so they are parsed against
    // it, then moved past the stripped fallback prefix into the decoded body.
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

// A reply's fallback quote was stripped from `body`, so the parsed mention
// offsets (relative to the wire body) shift back by the prefix's length. A
// mention that pointed into the quote keeps its JID and loses its offsets,
// like any other unusable range.
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
  // T-1406: an old stanza carries no `<stage/>`; a status an old client sent
  // without one is absent, and the clients then show the bare dots.
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

// The live delivered notice (T-1245): a bodiless headline the server sends
// from my own bare JID to my own resource. It is trusted only when the `from`
// bare JID is exactly mine; anything else (a spoofed or foreign stanza) is
// ignored, so no one can move my ticks.
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
