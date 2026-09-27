import { xml, type XmppElement } from '@xmpp/client';
import { decodePayload, encodePayload, type Payload } from '@galena/protocol';
import { bareJid, jidDomain, jidResource } from './jid';
import { capBody } from './text';
import {
  AGENT_NAMESPACE,
  CARBONS_NAMESPACE,
  CHAT_MARKERS_NAMESPACE,
  CHAT_STATES_NAMESPACE,
  DELAY_NAMESPACE,
  FORWARD_NAMESPACE,
  MAM_NAMESPACE,
  MUC_NAMESPACE,
  MUC_USER_NAMESPACE,
  OCCUPANT_ID_NAMESPACE,
  REPLY_NAMESPACE,
  STANZA_ID_NAMESPACE,
} from './namespaces';
import type {
  ChatKind,
  ChatMessage,
  DisplayedEvent,
  Occupant,
  PresenceEvent,
  TypingEvent,
} from './types';

const CHAT_STATES: ReadonlyArray<'composing' | 'paused' | 'active'> = [
  'composing',
  'paused',
  'active',
];

export type ReplyRef = { id: string; to?: string };

// ---------------------------------------------------------------------------
// Outgoing stanzas
// ---------------------------------------------------------------------------

export function buildMessage(options: {
  id: string;
  to: string;
  kind: ChatKind;
  text: string;
  payload?: Payload | undefined;
  replyTo?: ReplyRef | undefined;
}): XmppElement {
  const children: XmppElement[] = [xml('body', {}, options.text)];

  if (options.payload !== undefined) {
    children.push(xml('agent', { xmlns: AGENT_NAMESPACE }, encodePayload(options.payload)));
  }

  if (options.replyTo !== undefined) {
    const attrs: Record<string, string> = {
      xmlns: REPLY_NAMESPACE,
      id: options.replyTo.id,
    };
    if (options.replyTo.to !== undefined) {
      attrs['to'] = options.replyTo.to;
    }
    children.push(xml('reply', attrs));
  }

  return xml('message', { type: options.kind, to: options.to, id: options.id }, ...children);
}

export function buildTyping(options: {
  to: string;
  kind: ChatKind;
  state: 'composing' | 'paused' | 'active';
}): XmppElement {
  return xml(
    'message',
    { type: options.kind, to: options.to },
    xml(options.state, { xmlns: CHAT_STATES_NAMESPACE }),
  );
}

export function buildDisplayed(options: {
  chatJid: string;
  kind: ChatKind;
  messageId: string;
}): XmppElement {
  return xml(
    'message',
    { type: options.kind, to: options.chatJid },
    xml('displayed', { xmlns: CHAT_MARKERS_NAMESPACE, id: options.messageId }),
  );
}

export function buildJoinPresence(roomJid: string, nick: string): XmppElement {
  return xml(
    'presence',
    { to: `${roomJid}/${nick}` },
    // maxstanzas=0: history comes from MAM, not from the MUC join.
    xml('x', { xmlns: MUC_NAMESPACE }, xml('history', { maxstanzas: '0' })),
  );
}

export function buildLeavePresence(roomJid: string, nick: string): XmppElement {
  return xml(
    'presence',
    { to: `${roomJid}/${nick}`, type: 'unavailable' },
    xml('x', { xmlns: MUC_NAMESPACE }),
  );
}

export function buildAvailablePresence(): XmppElement {
  return xml('presence');
}

export function buildCarbonsEnable(id: string): XmppElement {
  return xml('iq', { type: 'set', id }, xml('enable', { xmlns: CARBONS_NAMESPACE }));
}

// ---------------------------------------------------------------------------
// Incoming parsing
// ---------------------------------------------------------------------------

export type ParseContext = {
  me?: string | undefined;
  domain: string;
  mucDomain: string;
  now: () => Date;
  /** Live occupant roster for a room, keyed by occupant JID (`room/nick`). */
  rosterFor?: ((roomJid: string) => ReadonlyMap<string, Occupant> | undefined) | undefined;
  /** The nick I joined a room with, used to mark my own messages outgoing. */
  myNickFor?: ((roomJid: string) => string | undefined) | undefined;
};

export type DecodedStanza = {
  message?: ChatMessage;
  typing?: TypingEvent;
  displayed?: DisplayedEvent;
};

/** A MUC presence event from a room, trusted only when it comes from the room. */
export type MucPresence = {
  roomJid: string;
  occupantJid: string;
  nick: string;
  available: boolean;
  realJid?: string;
  occupantId?: string;
  affiliation?: string;
  role?: string;
};

export type SenderResolution = {
  jid: string;
  resolved: boolean;
  occupantId?: string;
  outgoing: boolean;
};

type Envelope = {
  inner: XmppElement;
  forwardedDelay?: string;
  archiveId?: string;
};

function unwrapMessage(stanza: XmppElement): Envelope {
  const carbon =
    stanza.getChild('sent', CARBONS_NAMESPACE) ?? stanza.getChild('received', CARBONS_NAMESPACE);
  const mamResult = stanza.getChild('result', MAM_NAMESPACE);
  const container = carbon ?? mamResult;
  if (container === undefined) {
    return { inner: stanza };
  }

  const forwarded = container.getChild('forwarded', FORWARD_NAMESPACE);
  const inner = forwarded?.getChild('message');
  if (forwarded === undefined || inner === undefined) {
    return { inner: stanza };
  }

  const envelope: Envelope = { inner };
  const stamp = forwarded.getChild('delay', DELAY_NAMESPACE)?.attrs['stamp'];
  if (stamp !== undefined) {
    envelope.forwardedDelay = stamp;
  }
  if (mamResult !== undefined && mamResult.attrs['id'] !== undefined) {
    envelope.archiveId = mamResult.attrs['id'];
  }
  return envelope;
}

export function isMamResult(stanza: XmppElement): boolean {
  return stanza.getChild('result', MAM_NAMESPACE) !== undefined;
}

export function mamResultQueryId(stanza: XmppElement): string | undefined {
  return stanza.getChild('result', MAM_NAMESPACE)?.attrs['queryid'];
}

export function stanzaErrorCondition(stanza: XmppElement): string {
  const condition = stanza.getChild('error')?.getChildElements()[0];
  return condition?.getName() ?? 'unknown error';
}

function messageKind(stanza: XmppElement): ChatKind | undefined {
  const type = stanza.attrs['type'];
  if (type === 'groupchat') return 'groupchat';
  if (type === undefined || type === 'chat') return 'chat';
  return undefined;
}

function domainAllowed(from: string, kind: ChatKind, ctx: ParseContext): boolean {
  const domain = jidDomain(from);
  return kind === 'groupchat' ? domain === ctx.mucDomain : domain === ctx.domain;
}

function mucUserItem(stanza: XmppElement): XmppElement | undefined {
  return stanza.getChild('x', MUC_USER_NAMESPACE)?.getChild('item');
}

export function occupantIdOf(stanza: XmppElement): string | undefined {
  const occupantId = stanza.getChild('occupant-id', OCCUPANT_ID_NAMESPACE)?.attrs['id'];
  return occupantId === '' ? undefined : occupantId;
}

// A MUC presence is only trusted when it comes from the room itself: a JID on
// the MUC domain with a nick. Identity claims from anyone else are ignored.
export function parseMucPresence(stanza: XmppElement, mucDomain: string): MucPresence | undefined {
  if (!stanza.is('presence')) return undefined;
  const from = stanza.attrs['from'];
  if (from === undefined || jidDomain(from) !== mucDomain) return undefined;
  const nick = jidResource(from);
  if (nick === undefined || nick === '') return undefined;

  const type = stanza.attrs['type'];
  if (type !== undefined && type !== 'unavailable') return undefined;

  const roomJid = bareJid(from);
  const item = mucUserItem(stanza);
  const presence: MucPresence = {
    roomJid,
    occupantJid: `${roomJid}/${nick}`,
    nick,
    available: type === undefined,
  };

  const itemJid = item?.attrs['jid'];
  if (itemJid !== undefined && itemJid !== '') presence.realJid = bareJid(itemJid);
  const occupantId = occupantIdOf(stanza);
  if (occupantId !== undefined) presence.occupantId = occupantId;
  const affiliation = item?.attrs['affiliation'];
  if (affiliation !== undefined) presence.affiliation = affiliation;
  const role = item?.attrs['role'];
  if (role !== undefined) presence.role = role;
  return presence;
}

// A contact's presence is a bare-JID stanza from our own domain. MUC presence
// (resources on the MUC domain) is handled by `parseMucPresence`; subscription
// requests and errors are not availability and are ignored.
export function parseContactPresence(
  stanza: XmppElement,
  domain: string,
): PresenceEvent | undefined {
  if (!stanza.is('presence')) return undefined;
  const from = stanza.attrs['from'];
  if (from === undefined || jidDomain(from) !== domain) return undefined;
  const type = stanza.attrs['type'];
  if (type !== undefined && type !== 'unavailable') return undefined;
  const jid = bareJid(from);
  if (!jid.includes('@')) return undefined;
  return { jid, available: type === undefined };
}

function findOccupantByOccupantId(
  roster: ReadonlyMap<string, Occupant>,
  occupantId: string,
): Occupant | undefined {
  for (const occupant of roster.values()) {
    if (occupant.occupantId === occupantId) return occupant;
  }
  return undefined;
}

function isOutgoing(
  realJid: string,
  nick: string,
  me: string | undefined,
  myNick: string | undefined,
): boolean {
  return (me !== undefined && realJid === me) || (myNick !== undefined && nick === myNick);
}

// Resolves a sender to a real bare JID, in the spec's order: a JID carried by
// the message itself, then the message's occupant-id, then the nick against the
// room roster. Falls back to the occupant JID when nothing resolves.
export function resolveSender(input: {
  kind: ChatKind;
  from: string;
  itemJid?: string | undefined;
  occupantId?: string | undefined;
  me?: string | undefined;
  myNick?: string | undefined;
  roster?: ReadonlyMap<string, Occupant> | undefined;
}): SenderResolution {
  if (input.kind === 'chat') {
    const jid = bareJid(input.from);
    return { jid, resolved: true, outgoing: input.me !== undefined && jid === input.me };
  }

  const roomJid = bareJid(input.from);
  const nick = jidResource(input.from);
  const carryOccupantId = input.occupantId !== undefined ? { occupantId: input.occupantId } : {};

  if (input.itemJid !== undefined && input.itemJid !== '') {
    const jid = bareJid(input.itemJid);
    return {
      jid,
      resolved: true,
      ...carryOccupantId,
      outgoing: input.me !== undefined && jid === input.me,
    };
  }

  if (input.occupantId !== undefined && input.roster !== undefined) {
    const occupant = findOccupantByOccupantId(input.roster, input.occupantId);
    if (occupant?.realJid !== undefined) {
      return {
        jid: occupant.realJid,
        resolved: true,
        ...carryOccupantId,
        outgoing: isOutgoing(occupant.realJid, occupant.nick, input.me, input.myNick),
      };
    }
  }

  if (nick !== undefined && nick !== '' && input.roster !== undefined) {
    const occupant = input.roster.get(`${roomJid}/${nick}`);
    if (occupant?.realJid !== undefined) {
      return {
        jid: occupant.realJid,
        resolved: true,
        ...carryOccupantId,
        outgoing: isOutgoing(occupant.realJid, occupant.nick, input.me, input.myNick),
      };
    }
  }

  return {
    jid: input.from,
    resolved: false,
    ...carryOccupantId,
    outgoing: nick !== undefined && nick !== '' && nick === input.myNick,
  };
}

function conversationJid(
  stanza: XmppElement,
  from: string,
  kind: ChatKind,
  me: string | undefined,
): string {
  if (kind === 'groupchat') {
    return bareJid(from);
  }
  const sender = bareJid(from);
  const to = stanza.attrs['to'];
  // For my own DM (reflection, carbon, archive), the peer is the recipient.
  if (me !== undefined && sender === me && to !== undefined) {
    return bareJid(to);
  }
  return sender;
}

function fromNick(stanza: XmppElement, from: string, kind: ChatKind): string | undefined {
  if (kind !== 'groupchat') return undefined;
  const resource = jidResource(from);
  if (resource !== undefined && resource !== '') return resource;
  const nick = mucUserItem(stanza)?.attrs['nick'];
  return nick === '' ? undefined : nick;
}

function messageId(
  stanza: XmppElement,
  archiveId: string | undefined,
  kind: ChatKind,
  chatJid: string,
  me: string | undefined,
): string {
  const stanzaIds = stanza.getChildren('stanza-id', STANZA_ID_NAMESPACE);
  const archiveBy = kind === 'groupchat' ? chatJid : me;
  const matching = stanzaIds.find(
    (element) => element.attrs['by'] === archiveBy && element.attrs['id'] !== undefined,
  );
  const chosen = matching ?? stanzaIds.find((element) => element.attrs['id'] !== undefined);
  const stanzaId = chosen?.attrs['id'];
  if (stanzaId !== undefined) return stanzaId;
  if (archiveId !== undefined) return archiveId;
  return stanza.attrs['id'] ?? '';
}

function timestamp(
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

function parseReply(stanza: XmppElement): ReplyRef | undefined {
  const reply = stanza.getChild('reply', REPLY_NAMESPACE);
  const id = reply?.attrs['id'];
  if (reply === undefined || id === undefined) return undefined;
  const to = reply.attrs['to'];
  return to === undefined ? { id } : { id, to };
}

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

  const bodyElement = inner.getChild('body');
  const body = bodyElement === undefined ? undefined : capBody(bodyElement.text());

  const agent = inner.getChild('agent', AGENT_NAMESPACE);
  let payload: Payload | undefined;
  if (agent !== undefined) {
    const result = decodePayload(agent.text());
    if (result.ok) {
      payload = result.payload;
    }
  }

  if (body !== undefined || payload !== undefined) {
    const message: ChatMessage = {
      id: messageId(inner, envelope.archiveId, kind, chatJid, ctx.me),
      chatJid,
      kind,
      fromJid: sender.jid,
      fromResolved: sender.resolved,
      timestamp: timestamp(inner, envelope.forwardedDelay, ctx),
      outgoing: sender.outgoing,
    };
    if (sender.occupantId !== undefined) message.occupantId = sender.occupantId;
    if (body !== undefined) message.body = body;
    if (payload !== undefined) message.payload = payload;
    if (kind === 'groupchat') {
      const nick = fromNick(inner, from, kind);
      if (nick !== undefined) message.fromNick = nick;
    }
    const replyTo = parseReply(inner);
    if (replyTo !== undefined) message.replyTo = replyTo;
    decoded.message = message;
  }

  const typing = parseTyping(inner, kind, from, ctx, sender.jid);
  if (typing !== undefined) decoded.typing = typing;

  const displayed = parseDisplayed(inner, kind, from, ctx, sender.jid);
  if (displayed !== undefined) decoded.displayed = displayed;

  return decoded;
}

function parseTyping(
  stanza: XmppElement,
  kind: ChatKind,
  from: string,
  ctx: ParseContext,
  senderJid: string,
): TypingEvent | undefined {
  const state = CHAT_STATES.find(
    (candidate) => stanza.getChild(candidate, CHAT_STATES_NAMESPACE) !== undefined,
  );
  if (state === undefined) return undefined;
  return {
    chatJid: conversationJid(stanza, from, kind, ctx.me),
    fromJid: senderJid,
    state,
  };
}

function parseDisplayed(
  stanza: XmppElement,
  kind: ChatKind,
  from: string,
  ctx: ParseContext,
  senderJid: string,
): DisplayedEvent | undefined {
  const displayed = stanza.getChild('displayed', CHAT_MARKERS_NAMESPACE);
  const messageId = displayed?.attrs['id'];
  if (displayed === undefined || messageId === undefined) return undefined;
  return {
    chatJid: conversationJid(stanza, from, kind, ctx.me),
    fromJid: senderJid,
    messageId,
  };
}
