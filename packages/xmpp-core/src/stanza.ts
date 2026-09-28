import { xml, type XmppElement } from '@xmpp/client';
import { decodePayload, encodePayload, type Payload } from '@galena/protocol';
import { bareJid, jidDomain, jidResource } from './jid';
import { capBody } from './text';
import {
  AGENT_NAMESPACE,
  CARBONS_NAMESPACE,
  CHAT_MARKERS_NAMESPACE,
  CHAT_STATES_NAMESPACE,
  CONFERENCE_NAMESPACE,
  DELAY_NAMESPACE,
  FORWARD_NAMESPACE,
  HTTP_UPLOAD_NAMESPACE,
  MAM_NAMESPACE,
  MUC_NAMESPACE,
  MUC_USER_NAMESPACE,
  OCCUPANT_ID_NAMESPACE,
  REPLY_NAMESPACE,
  REFERENCE_NAMESPACE,
  ROSTER_NAMESPACE,
  STANZA_ID_NAMESPACE,
  STANZA_NAMESPACE,
} from './namespaces';
import type {
  ChatKind,
  ChatMessage,
  DisplayedEvent,
  InvitedEvent,
  Mention,
  MentionInput,
  Occupant,
  PresenceEvent,
  RosterEvent,
  RosterSubscription,
  TypingEvent,
  UploadSlot,
} from './types';

const CHAT_STATES: ReadonlyArray<'composing' | 'paused' | 'active'> = [
  'composing',
  'paused',
  'active',
];

// XEP-0372 references are capped so a hostile message cannot force unbounded
// work or memory.
const MAX_MENTIONS = 20;

export type ReplyRef = { id: string; to?: string };

// XEP-0372 counts offsets in Unicode code points, while JS strings are UTF-16.
// The helpers convert one unit into the other across a body. `Array.from` on a
// string counts code points (a surrogate pair is one entry).
function codePointLength(text: string): number {
  return Array.from(text).length;
}

function codePointOffset(text: string, utf16Index: number): number {
  return codePointLength(text.slice(0, utf16Index));
}

function utf16Offset(text: string, codePointIndex: number): number {
  let index = 0;
  let count = 0;
  for (const character of text) {
    if (count >= codePointIndex) {
      return index;
    }
    index += character.length;
    count += 1;
  }
  return index;
}

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
  mentions?: MentionInput[] | undefined;
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

  for (const mention of options.mentions ?? []) {
    children.push(
      xml('reference', {
        xmlns: REFERENCE_NAMESPACE,
        type: 'mention',
        uri: `xmpp:${mention.jid}`,
        begin: String(codePointOffset(options.text, mention.begin)),
        end: String(codePointOffset(options.text, mention.end)),
      }),
    );
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

// XEP-0363 §4: a slot request addressed to the upload service component.
export function buildUploadSlotRequest(options: {
  id: string;
  service: string;
  filename: string;
  size: number;
  contentType: string;
}): XmppElement {
  return xml(
    'iq',
    { type: 'get', id: options.id, to: options.service },
    xml('request', {
      xmlns: HTTP_UPLOAD_NAMESPACE,
      filename: options.filename,
      size: String(options.size),
      'content-type': options.contentType,
    }),
  );
}

// The slot response carries the PUT url (with headers) and the GET url.
export function parseUploadSlot(stanza: XmppElement): UploadSlot | undefined {
  const slot = stanza.getChild('slot', HTTP_UPLOAD_NAMESPACE);
  if (slot === undefined) return undefined;
  const putUrl = slot.getChild('put')?.attrs['url'];
  const getUrl = slot.getChild('get')?.attrs['url'];
  if (putUrl === undefined || putUrl === '' || getUrl === undefined || getUrl === '') {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const header of slot.getChild('put')?.getChildren('header') ?? []) {
    const name = header.attrs['name'];
    if (name !== undefined && name !== '') {
      headers[name] = header.text();
    }
  }
  return { putUrl, getUrl, headers };
}

// RFC 6121 §2.1.6: a client acknowledges a roster push with an empty result.
export function buildRosterResult(id: string, to?: string): XmppElement {
  const attrs: Record<string, string> = { type: 'result', id };
  if (to !== undefined) attrs['to'] = to;
  return xml('iq', attrs);
}

// A roster push that did not come from our own server is rejected.
export function buildRosterError(id: string, to?: string): XmppElement {
  const attrs: Record<string, string> = { type: 'error', id };
  if (to !== undefined) attrs['to'] = to;
  return xml(
    'iq',
    attrs,
    xml('error', { type: 'auth' }, xml('forbidden', { xmlns: STANZA_NAMESPACE })),
  );
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

// A XEP-0249 direct invitation is a message with a `jabber:x:conference`
// element naming the room. It is trusted only when the room is on our MUC
// domain and the sender is on one of our domains, so another server cannot
// point the client at an arbitrary room.
export function parseDirectInvitation(
  stanza: XmppElement,
  domain: string,
  mucDomain: string,
): InvitedEvent | undefined {
  if (!stanza.is('message')) return undefined;
  const conference = stanza.getChild('x', CONFERENCE_NAMESPACE);
  const roomJid = conference?.attrs['jid'];
  if (conference === undefined || roomJid === undefined || roomJid === '') return undefined;
  if (jidDomain(roomJid) !== mucDomain) return undefined;

  const from = stanza.attrs['from'];
  if (from === undefined) return undefined;
  const fromDomain = jidDomain(from);
  if (fromDomain !== domain && fromDomain !== mucDomain) return undefined;

  const invited: InvitedEvent = { roomJid: bareJid(roomJid), fromJid: bareJid(from) };
  const reason = conference.attrs['reason'];
  if (reason !== undefined && reason !== '') invited.reason = reason;
  return invited;
}

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

// RFC 6121 §2.1.6: a roster push is an `iq type="set"` with a roster query,
// sent by our own server (no `from`), our own bare JID or our domain. Anything
// else is a spoof and is answered with an error instead of being applied.
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
function parseMentions(stanza: XmppElement, body: string | undefined): Mention[] | undefined {
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
