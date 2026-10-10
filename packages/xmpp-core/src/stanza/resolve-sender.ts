import type { XmppElement } from '@xmpp/client';
import { bareJid, jidResource } from '../jid';
import { STANZA_ID_NAMESPACE } from '../namespaces';
import type { ChatKind, Occupant } from '../types';
import type { SenderResolution } from './parse-context';
import { mucUserItem } from './parse-presence';

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

export function conversationJid(
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

export function fromNick(stanza: XmppElement, from: string, kind: ChatKind): string | undefined {
  if (kind !== 'groupchat') return undefined;
  const resource = jidResource(from);
  if (resource !== undefined && resource !== '') return resource;
  const nick = mucUserItem(stanza)?.attrs['nick'];
  return nick === '' ? undefined : nick;
}

export function messageId(
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
