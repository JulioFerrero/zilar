import type { XmppElement } from '@xmpp/client';
import { bareJid } from './jid';
import { ROSTER_NAMESPACE } from './namespaces';
import type { RosterEvent, RosterSubscription } from './types';

export { sanitizeReactions, type ReplyRef } from './stanza/reactions';

export {
  buildMessage,
  buildCorrection,
  RETRACTION_FALLBACK_BODY,
  buildRetraction,
  buildTyping,
  MAX_STATUS_CHARS,
  buildDisplayed,
  buildPingRequest,
  buildPingResult,
  buildReactions,
  buildJoinPresence,
  buildLeavePresence,
  buildAvailablePresence,
  buildCarbonsEnable,
  buildPushEnable,
  buildPushDisable,
  buildUploadSlotRequest,
  parseUploadSlot,
  buildRosterResult,
  buildRosterError,
} from './stanza/build-outgoing';

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

export { resolveSender } from './stanza/resolve-sender';

export {
  parseReactions,
  parseCorrection,
  parseRetraction,
  parseForward,
  originIdOf,
} from './stanza/parse-fields';

export { albumElement, parseAlbum, ALBUM_ID_MAX, ALBUM_MAX } from './stanza/album';

export { decodeMessageStanza } from './stanza/decode';
