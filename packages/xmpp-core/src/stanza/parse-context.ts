import type { XmppElement } from '@xmpp/client';
import { bareJid, jidDomain } from '../jid';
import {
  CARBONS_NAMESPACE,
  DELAY_NAMESPACE,
  FORWARD_NAMESPACE,
  MAM_NAMESPACE,
} from '../namespaces';
import type { ChatMessage, DisplayedEvent, Occupant, TypingEvent } from '../types';
import type { DeliveredMarkEvent } from '../types-delivered';

export type ParseContext = {
  me?: string | undefined;
  domain: string;
  mucDomain: string;
  now: () => Date;
  /** Live occupant roster for a room, keyed by occupant JID (`room/nick`). */
  rosterFor?: ((roomJid: string) => ReadonlyMap<string, Occupant> | undefined) | undefined;
  myNickFor?: ((roomJid: string) => string | undefined) | undefined;
};

export type DecodedStanza = {
  message?: ChatMessage;
  typing?: TypingEvent;
  displayed?: DisplayedEvent;
  deliveredMark?: DeliveredMarkEvent;
};

export type MucPresence = {
  roomJid: string;
  occupantJid: string;
  nick: string;
  available: boolean;
  realJid?: string;
  occupantId?: string;
  affiliation?: string;
  role?: string;
  /** MUC status codes from `<x xmlns="...#user"><status code/>` (321, 307, 301: removal). */
  statusCodes?: number[];
};

export type SenderResolution = {
  jid: string;
  resolved: boolean;
  occupantId?: string;
  outgoing: boolean;
};

export interface MessageCorrection {
  targetId: string;
}

export interface MessageRetraction {
  /** The original message's id: its origin id in DMs, its stanza-id in groups. */
  targetId: string;
}

export interface MessageReactions {
  targetId: string;
  /** The reactor's complete current set; empty means the reaction was cleared. */
  emojis: string[];
}

export interface Mention {
  /** Bare JID of the mentioned account, lowercased. */
  jid: string;
  /** Start offset in UTF-16 code units, when the reference carried one. */
  begin?: number;
  /** End offset (exclusive) in UTF-16 code units, when it carried one. */
  end?: number;
}

export interface MentionInput {
  jid: string;
  begin: number;
  end: number;
}

type Envelope = {
  inner: XmppElement;
  forwarded: boolean;
  archived: boolean;
  forwardedDelay?: string;
  archiveId?: string;
};

// XEP-0280 §11: a carbon is trusted only when it comes from my own account.
function carbonTrusted(stanza: XmppElement, ctx: ParseContext): boolean {
  const from = stanza.attrs['from'];
  if (from === undefined) return true;
  return ctx.me !== undefined && bareJid(from) === ctx.me;
}

// A MAM result comes from my own account or from the queried room's bare JID.
export function mamResultTrusted(stanza: XmppElement, ctx: ParseContext): boolean {
  const from = stanza.attrs['from'];
  if (from === undefined) return true;
  if (ctx.me !== undefined && bareJid(from) === ctx.me) return true;
  return bareJid(from) === from && jidDomain(from) === ctx.mucDomain;
}

export function unwrapMessage(stanza: XmppElement, ctx: ParseContext): Envelope {
  const carbon =
    stanza.getChild('sent', CARBONS_NAMESPACE) ?? stanza.getChild('received', CARBONS_NAMESPACE);
  const mamResult = stanza.getChild('result', MAM_NAMESPACE);
  const live: Envelope = { inner: stanza, forwarded: false, archived: false };
  const trustedCarbon = carbon !== undefined && carbonTrusted(stanza, ctx) ? carbon : undefined;
  const trustedResult =
    mamResult !== undefined && mamResultTrusted(stanza, ctx) ? mamResult : undefined;
  const container = trustedCarbon ?? trustedResult;
  if (container === undefined) {
    return live;
  }

  const forwarded = container.getChild('forwarded', FORWARD_NAMESPACE);
  const inner = forwarded?.getChild('message');
  if (forwarded === undefined || inner === undefined) {
    return live;
  }

  const envelope: Envelope = { inner, forwarded: true, archived: trustedResult !== undefined };
  const stamp = forwarded.getChild('delay', DELAY_NAMESPACE)?.attrs['stamp'];
  if (stamp !== undefined) {
    envelope.forwardedDelay = stamp;
  }
  if (trustedResult !== undefined && trustedResult.attrs['id'] !== undefined) {
    envelope.archiveId = trustedResult.attrs['id'];
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
