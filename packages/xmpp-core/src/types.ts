import type { ForwardOrigin, Payload } from '@zilar/protocol';
import type { Effect } from 'effect';
import type { NotOnline, XmppCoreError } from './errors';
import type { MessageAlbum } from './stanza/album';
import type {
  Mention,
  MentionInput,
  MessageCorrection,
  MessageReactions,
  MessageRetraction,
  MucPresence,
} from './stanza/parse-context';
import type { XmppSuspend, XmppSuspendEffect } from './types-suspend';

export type {
  Mention,
  MentionInput,
  MessageCorrection,
  MessageReactions,
  MessageRetraction,
} from './stanza/parse-context';

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export type ChatKind = 'groupchat' | 'chat';

export interface XmppCoreOptions {
  /** WebSocket service, e.g. `ws://127.0.0.1:5280/ws`. */
  service: string;
  /** XMPP domain, e.g. `zilar.localhost`. Rooms live on `rooms.<domain>`. */
  domain: string;
  /** Called for every (re)connect; must return a fresh short-lived JWT. */
  getToken: () => Promise<{ jid: string; token: string }>;
  /**
   * Idle time without a received stanza before the client pings the server
   * (XEP-0199). Defaults to 30 000; 0 disables the keepalive.
   */
  keepaliveMs?: number;
  /**
   * Time to wait for the keepalive reply (a result or an error counts) before the
   * connection is treated as dead; defaults 15 000, 0 disables.
   */
  keepaliveTimeoutMs?: number;
  /** How long connecting may last before a fresh client replaces it; 5, 8, 12 then 20 s. */
  reconnectWatchdogMs?: number;
  resource?: string;
}

export interface ChatMessage {
  /** Archive stanza-id (XEP-0359) when known, else the message id. */
  id: string;
  /** The sender-generated id (XEP-0359), so an edit can name the original (XEP-0308). */
  originId?: string;
  chatJid: string;
  kind: ChatKind;
  fromJid: string;
  fromResolved: boolean;
  fromNick?: string;
  occupantId?: string;
  body?: string;
  payload?: Payload;
  album?: MessageAlbum;
  forward?: ForwardOrigin;
  replyTo?: { id: string; to?: string; text?: string };
  /** XEP-0444 reactions from a body-less message: target id and full set; not a chat message. */
  reactions?: MessageReactions;
  /** XEP-0308 correction: the target's id; `body` is the new full text, not a message of its own. */
  correction?: MessageCorrection;
  /** XEP-0424 retraction: the target's id; `body` is dropped, not a message of its own. */
  retraction?: MessageRetraction;
  /** XEP-0372 mentions; offsets are UTF-16 code units, converted to code points on the wire. */
  mentions?: Mention[];
  timestamp: Date;
  outgoing: boolean;
}

export interface Occupant {
  jid: string;
  nick: string;
  realJid?: string;
  occupantId?: string;
  affiliation?: string;
  role?: string;
  available: boolean;
}

export interface OccupantsEvent {
  roomJid: string;
  occupants: Occupant[];
}

export interface HistoryPage {
  messages: ChatMessage[];
  complete: boolean;
  first?: string;
}

export interface TypingEvent {
  chatJid: string;
  fromJid: string;
  state: 'composing' | 'paused' | 'active';
  status?: string;
  outgoing: boolean;
}

export interface PresenceEvent {
  jid: string;
  available: boolean;
  delayedAt?: number;
}
export type ParsedMucPresence = MucPresence & { destroyed?: true };

export interface DisplayedEvent {
  chatJid: string;
  fromJid: string;
  messageId: string;
  outgoing: boolean;
}

export interface InvitedEvent {
  roomJid: string;
  fromJid?: string;
  reason?: string;
}

export type RosterSubscription = 'none' | 'to' | 'from' | 'both' | 'remove';

export interface RosterEvent {
  jid: string;
  subscription: RosterSubscription;
  name?: string;
}

export interface SendMessageOptions {
  payload?: Payload;
  forward?: ForwardOrigin;
  replyTo?: { id: string; to?: string; text?: string };
  mentions?: MentionInput[];
  album?: MessageAlbum;
  id?: string;
}

export interface SendCorrectionOptions {
  mentions?: MentionInput[];
  payload?: Payload;
}

export interface UploadRequest {
  filename: string;
  size: number;
  contentType: string;
}

export interface UploadSlot {
  putUrl: string;
  getUrl: string;
  headers: Record<string, string>;
}

export interface LoadHistoryOptions {
  before?: string;
  max?: number;
}

export interface ErrorEvent {
  message: string;
}

export interface XmppCore extends XmppSuspend {
  status(): ConnectionStatus;
  me(): string | undefined;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  joinRoom(roomJid: string, nick: string): Promise<void>;
  leaveRoom(roomJid: string): Promise<void>;
  occupants(roomJid: string): Occupant[];
  sendMessage(
    to: string,
    kind: ChatKind,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<{ id: string }>;
  sendReactions(chatJid: string, kind: ChatKind, targetId: string, emojis: string[]): Promise<void>;
  sendCorrection(
    chatJid: string,
    kind: ChatKind,
    originalId: string,
    text: string,
    opts?: SendCorrectionOptions,
  ): Promise<{ id: string }>;
  sendRetraction(chatJid: string, kind: ChatKind, targetId: string): Promise<void>;
  loadHistory(chatJid: string, kind: ChatKind, opts?: LoadHistoryOptions): Promise<HistoryPage>;
  requestUploadSlot(request: UploadRequest): Promise<UploadSlot>;
  setPushEnabled?: (options: { pushJid: string; node: string; enable: boolean }) => Promise<void>;
  sendTyping(to: string, kind: ChatKind, state: 'composing' | 'paused', status?: string): void;
  markDisplayed(chatJid: string, kind: ChatKind, messageId: string): void;
  on(event: 'status', cb: (s: ConnectionStatus) => void): () => void;
  on(event: 'message', cb: (m: ChatMessage) => void): () => void;
  on(
    event: 'typing',
    cb: (e: {
      chatJid: string;
      fromJid: string;
      state: 'composing' | 'paused' | 'active';
      outgoing: boolean;
    }) => void,
  ): () => void;
  on(
    event: 'displayed',
    cb: (e: { chatJid: string; fromJid: string; messageId: string; outgoing: boolean }) => void,
  ): () => void;
  on(event: 'occupants', cb: (e: { roomJid: string; occupants: Occupant[] }) => void): () => void;
  on(event: 'presence', cb: (e: PresenceEvent) => void): () => void;
  on(event: 'invited', cb: (e: InvitedEvent) => void): () => void;
  on(event: 'roster', cb: (e: RosterEvent) => void): () => void;
  on(event: 'error', cb: (e: { message: string }) => void): () => void;
  on(event: 'replaced', cb: () => void): () => void;
}

export type SendError = NotOnline | Error;

export interface XmppCoreEffect extends XmppSuspendEffect {
  status(): ConnectionStatus;
  me(): string | undefined;
  occupants(roomJid: string): Occupant[];
  connect(): Effect.Effect<void, Error>;
  disconnect(): Effect.Effect<void>;
  joinRoom(roomJid: string, nick: string): Effect.Effect<void, XmppCoreError>;
  leaveRoom(roomJid: string): Effect.Effect<void>;
  sendMessage(
    to: string,
    kind: ChatKind,
    text: string,
    opts?: SendMessageOptions,
  ): Effect.Effect<{ id: string }, SendError>;
  sendReactions(
    chatJid: string,
    kind: ChatKind,
    targetId: string,
    emojis: string[],
  ): Effect.Effect<void, SendError>;
  sendCorrection(
    chatJid: string,
    kind: ChatKind,
    originalId: string,
    text: string,
    opts?: SendCorrectionOptions,
  ): Effect.Effect<{ id: string }, SendError>;
  sendRetraction(chatJid: string, kind: ChatKind, targetId: string): Effect.Effect<void, SendError>;
  loadHistory(
    chatJid: string,
    kind: ChatKind,
    opts?: LoadHistoryOptions,
  ): Effect.Effect<HistoryPage, XmppCoreError>;
  requestUploadSlot(request: UploadRequest): Effect.Effect<UploadSlot, XmppCoreError>;
  setPushEnabled(options: {
    pushJid: string;
    node: string;
    enable: boolean;
  }): Effect.Effect<void, XmppCoreError>;
  sendTyping(
    to: string,
    kind: ChatKind,
    state: 'composing' | 'paused',
    status?: string,
  ): Effect.Effect<void>;
  markDisplayed(chatJid: string, kind: ChatKind, messageId: string): Effect.Effect<void>;
}
