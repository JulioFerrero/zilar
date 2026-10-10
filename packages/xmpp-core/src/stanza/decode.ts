import type { XmppElement } from '@xmpp/client';
import { decodePayload, type Payload } from '@zilar/protocol';
import { bareJid } from '../jid';
import { AGENT_NAMESPACE, CHAT_MARKERS_NAMESPACE, CHAT_STATES_NAMESPACE } from '../namespaces';
import { capBody } from '../text';
import type { ChatKind, ChatMessage, DisplayedEvent, TypingEvent } from '../types';
import {
  parseCorrection,
  parseForward,
  parseMentions,
  parseReactions,
  parseRetraction,
  parseReply,
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
  const kind = messageKind(inner);
  const from = inner.attrs['from'];
  if (kind === undefined || from === undefined || !domainAllowed(from, kind, ctx)) {
    return {};
  }

  const decoded: DecodedStanza = {};

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
  const body =
    retraction !== undefined || bodyElement === undefined ? undefined : capBody(bodyElement.text());

  const agent = inner.getChild('agent', AGENT_NAMESPACE);
  let payload: Payload | undefined;
  if (agent !== undefined) {
    const result = decodePayload(agent.text());
    if (result.ok) {
      payload = result.payload;
    }
  }

  const reactions = parseReactions(inner);

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
    const mentions = parseMentions(inner, body);
    if (mentions !== undefined) message.mentions = mentions;
    decoded.message = message;
  }

  const typing = parseTyping(inner, kind, from, ctx, sender);
  if (typing !== undefined) decoded.typing = typing;

  const displayed = parseDisplayed(inner, kind, from, ctx, sender);
  if (displayed !== undefined) decoded.displayed = displayed;

  return decoded;
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
  return {
    chatJid: conversationJid(stanza, from, kind, ctx.me),
    fromJid: sender.jid,
    state,
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
