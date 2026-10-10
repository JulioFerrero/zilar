export { sanitizeReactions, type ReplyRef } from './stanza/reactions';

export {
  buildMessage,
  buildCorrection,
  RETRACTION_FALLBACK_BODY,
  buildRetraction,
  buildTyping,
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

export { parseRosterPush, type RosterPush } from './stanza/parse-roster';

export { resolveSender } from './stanza/resolve-sender';

export {
  parseReactions,
  parseCorrection,
  parseRetraction,
  parseForward,
  originIdOf,
} from './stanza/parse-fields';

export { decodeMessageStanza } from './stanza/decode';
