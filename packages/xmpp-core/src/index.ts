import { createCore } from './client';
import type { XmppCore, XmppCoreOptions } from './types';

export type {
  ChatKind,
  ChatMessage,
  ConnectionStatus,
  DisplayedEvent,
  ErrorEvent,
  HistoryPage,
  LoadHistoryOptions,
  Occupant,
  OccupantsEvent,
  PresenceEvent,
  SendMessageOptions,
  TypingEvent,
  XmppCore,
  XmppCoreOptions,
} from './types';

/**
 * Creates the shared XMPP client. The returned object is the only chat API the
 * web and mobile apps use; each (re)connect asks `getToken` for a fresh JWT.
 */
export function createXmppCore(options: XmppCoreOptions): XmppCore {
  return createCore(options);
}
