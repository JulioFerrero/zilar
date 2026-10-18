import { createCore } from './client';
import { createCoreEffect } from './core-effect';
import type { XmppCore, XmppCoreEffect, XmppCoreOptions } from './types';

export type { EventName, EventPayload } from './events';

export type {
  ChatKind,
  ChatMessage,
  ConnectionStatus,
  DeliveredMarkEvent,
  DisplayedEvent,
  ErrorEvent,
  HistoryPage,
  InvitedEvent,
  LoadHistoryOptions,
  Mention,
  MentionInput,
  MessageAlbum,
  MessageCorrection,
  MessageReactions,
  MessageRetraction,
  Occupant,
  OccupantsEvent,
  PresenceEvent,
  RosterEvent,
  RosterSubscription,
  SendCorrectionOptions,
  SendError,
  SendMessageOptions,
  TypingEvent,
  UploadRequest,
  UploadSlot,
  XmppCore,
  XmppCoreEffect,
  XmppCoreOptions,
} from './types';
export {
  ConnectionFailed,
  ConnectTimeout,
  Disconnected,
  HistoryFailed,
  HistorySendFailed,
  HistoryTimeout,
  IqFailed,
  JoinRejected,
  JoinSendFailed,
  JoinTimeout,
  NoIdentity,
  NotOnline,
  PushToggleFailed,
  PushToggleTimeout,
  UploadSlotFailed,
  UploadSlotInvalid,
  UploadSlotTimeout,
} from './errors';
export type { XmppCoreError } from './errors';

// The notification reply route builds the same stanza the app sends.
export { buildMessage } from './stanza/build-outgoing';

// The read route sends the same XEP-0333 marker the apps send.
export { buildDisplayed } from './stanza/build-control';

/** The shared XMPP client, the only chat API the apps use; each (re)connect asks
 * `getToken` for a fresh JWT. */
export function createXmppCore(options: XmppCoreOptions): XmppCore {
  return createCore(options);
}

/** The same core with every method an `Effect` and one `Stream` per event; a plain
 * factory because the core is per-login state, not a Layer. */
export function createXmppCoreEffect(options: XmppCoreOptions): XmppCoreEffect {
  return createCoreEffect(options);
}
