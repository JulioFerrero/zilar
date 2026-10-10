import type { XmppElement } from '@xmpp/client';
import {
  CARBONS_NAMESPACE,
  DELAY_NAMESPACE,
  FORWARD_NAMESPACE,
  MAM_NAMESPACE,
} from '../namespaces';
import type { ChatMessage, DisplayedEvent, Occupant, TypingEvent } from '../types';

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

export function unwrapMessage(stanza: XmppElement): Envelope {
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
