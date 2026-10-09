import { createCore } from './client';
import { createCoreEffect } from './core-effect';
import type { XmppCore, XmppCoreEffect, XmppCoreOptions } from './types';

export type { EventName, EventPayload, EventStreams } from './events';

export type {
  ChatKind,
  ChatMessage,
  ConnectionStatus,
  DisplayedEvent,
  ErrorEvent,
  HistoryPage,
  InvitedEvent,
  LoadHistoryOptions,
  Mention,
  MentionInput,
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

/**
 * Creates the shared XMPP client. The returned object is the only chat API the
 * web and mobile apps use; each (re)connect asks `getToken` for a fresh JWT.
 */
export function createXmppCore(options: XmppCoreOptions): XmppCore {
  return createCore(options);
}

/**
 * Creates the shared XMPP client as Effects and Streams: the same core
 * `createXmppCore` wraps, with every method an `Effect` and one `Stream` per
 * event in `events`. A plain factory rather than a `Context.Service`, because
 * the core is per-login state built from the options (`getToken`, the domain),
 * and no consumer provides it through a Layer yet.
 */
export function createXmppCoreEffect(options: XmppCoreOptions): XmppCoreEffect {
  return createCoreEffect(options);
}
