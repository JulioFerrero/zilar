import type { XmppElement } from '@xmpp/client';
import { bareJid, jidDomain, jidResource } from '../jid';
import {
  CONFERENCE_NAMESPACE,
  DELAY_NAMESPACE,
  MUC_USER_NAMESPACE,
  OCCUPANT_ID_NAMESPACE,
} from '../namespaces';
import type { ChatKind, InvitedEvent, ParsedMucPresence, PresenceEvent } from '../types';
import type { ParseContext } from './parse-context';

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
export function parseMucPresence(
  stanza: XmppElement,
  mucDomain: string,
): ParsedMucPresence | undefined {
  if (!stanza.is('presence')) return undefined;
  const from = stanza.attrs['from'];
  if (from === undefined || jidDomain(from) !== mucDomain) return undefined;
  const nick = jidResource(from);
  if (nick === undefined || nick === '') return undefined;

  const type = stanza.attrs['type'];
  if (type !== undefined && type !== 'unavailable') return undefined;

  const roomJid = bareJid(from);
  const userX = stanza.getChild('x', MUC_USER_NAMESPACE);
  const item = userX?.getChild('item');
  const presence: ParsedMucPresence = {
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
  // The room's self-presence carries status codes (321 affiliation change, 307 kick,
  // 301 ban): an unavailable self-presence with one means the server removed me.
  const statuses = userX?.getChildren('status') ?? [];
  const codes: number[] = [];
  for (const status of statuses) {
    const code = Number(status.attrs['code']);
    if (Number.isInteger(code)) codes.push(code);
  }
  if (codes.length > 0) presence.statusCodes = codes;
  // XEP-0045 §10.9: a `<destroy/>` child means the room is gone, like a kick or a ban.
  if (userX?.getChild('destroy') !== undefined) presence.destroyed = true;
  return presence;
}

// A contact's presence is a bare-JID stanza from our own domain; MUC presence is handled
// by `parseMucPresence`. An unavailable presence may carry a `<delay/>` stamp, so the
// header can show when the contact was last seen.
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
  const event: PresenceEvent = { jid, available: type === undefined };
  if (!event.available) {
    const stamp = stanza.getChild('delay', DELAY_NAMESPACE)?.attrs['stamp'];
    if (stamp !== undefined) {
      const at = new Date(stamp).getTime();
      if (!Number.isNaN(at)) {
        event.delayedAt = at;
      }
    }
  }
  return event;
}

// A XEP-0249 invitation is trusted only when the room is on our MUC domain and the
// sender is on one of our domains, so another server cannot point us at a room.
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
