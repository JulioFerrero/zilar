import type { XmppElement } from '@xmpp/client';
import { bareJid, jidDomain, jidResource } from '../jid';
import { CONFERENCE_NAMESPACE, MUC_USER_NAMESPACE, OCCUPANT_ID_NAMESPACE } from '../namespaces';
import type { ChatKind, InvitedEvent, PresenceEvent } from '../types';
import type { MucPresence, ParseContext } from './parse-context';

export function messageKind(stanza: XmppElement): ChatKind | undefined {
  const type = stanza.attrs['type'];
  if (type === 'groupchat') return 'groupchat';
  if (type === undefined || type === 'chat') return 'chat';
  return undefined;
}

export function domainAllowed(from: string, kind: ChatKind, ctx: ParseContext): boolean {
  const domain = jidDomain(from);
  return kind === 'groupchat' ? domain === ctx.mucDomain : domain === ctx.domain;
}

export function mucUserItem(stanza: XmppElement): XmppElement | undefined {
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
