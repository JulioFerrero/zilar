import type { Payload } from '@galena/protocol';

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export type ChatKind = 'groupchat' | 'chat';

export interface XmppCoreOptions {
  /** WebSocket service, e.g. `ws://127.0.0.1:5280/ws`. */
  service: string;
  /** XMPP domain, e.g. `galena.localhost`. Rooms live on `rooms.<domain>`. */
  domain: string;
  /** Called for every (re)connect; must return a fresh short-lived JWT. */
  getToken: () => Promise<{ jid: string; token: string }>;
}

export interface ChatMessage {
  /** Archive stanza-id (XEP-0359) when known, else the message id. */
  id: string;
  /** Bare JID of the room, or of the DM peer. */
  chatJid: string;
  kind: ChatKind;
  /** Real bare JID of the sender when known, else the occupant JID. */
  fromJid: string;
  /** True when `fromJid` is a real bare JID, false when it is an occupant JID. */
  fromResolved: boolean;
  /** MUC nickname, when the message came from a room. */
  fromNick?: string;
  /** XEP occupant-id of the sender, when the message carries one. */
  occupantId?: string;
  body?: string;
  /** Decoded with `decodePayload`; invalid payloads are dropped. */
  payload?: Payload;
  replyTo?: { id: string; to?: string };
  /** From `<delay/>` or the archive; receive time when neither is present. */
  timestamp: Date;
  /** Sent by me, including room reflections and carbons. */
  outgoing: boolean;
}

/** One present occupant of a room, tracked from that room's MUC presence. */
export interface Occupant {
  /** Occupant JID: `roomJid/nick`. */
  jid: string;
  nick: string;
  /** Real bare JID, when the room is non-anonymous and reveals it. */
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
  /** Oldest first. */
  messages: ChatMessage[];
  /** True when the archive reported there is nothing older. */
  complete: boolean;
  /** RSM cursor: pass as `before` to load the previous page. */
  first?: string;
}

export interface TypingEvent {
  chatJid: string;
  fromJid: string;
  state: 'composing' | 'paused' | 'active';
}

/** A contact's (roster) availability, from a bare-JID presence stanza. */
export interface PresenceEvent {
  /** Bare JID of the contact. */
  jid: string;
  available: boolean;
}

export interface DisplayedEvent {
  chatJid: string;
  fromJid: string;
  messageId: string;
}

export interface SendMessageOptions {
  payload?: Payload;
  replyTo?: { id: string; to?: string };
}

export interface LoadHistoryOptions {
  /** Archive id to page before. */
  before?: string;
  /** Page size, default 50. */
  max?: number;
}

export interface ErrorEvent {
  message: string;
}

export interface XmppCore {
  status(): ConnectionStatus;
  /** My bare JID once online. */
  me(): string | undefined;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  joinRoom(roomJid: string, nick: string): Promise<void>;
  leaveRoom(roomJid: string): Promise<void>;
  /** Present occupants of a room, tracked from that room's MUC presence. */
  occupants(roomJid: string): Occupant[];
  sendMessage(
    to: string,
    kind: ChatKind,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<{ id: string }>;
  loadHistory(chatJid: string, kind: ChatKind, opts?: LoadHistoryOptions): Promise<HistoryPage>;
  sendTyping(to: string, kind: ChatKind, state: 'composing' | 'paused'): void;
  markDisplayed(chatJid: string, kind: ChatKind, messageId: string): void;
  on(event: 'status', cb: (s: ConnectionStatus) => void): () => void;
  on(event: 'message', cb: (m: ChatMessage) => void): () => void;
  on(
    event: 'typing',
    cb: (e: { chatJid: string; fromJid: string; state: 'composing' | 'paused' | 'active' }) => void,
  ): () => void;
  on(
    event: 'displayed',
    cb: (e: { chatJid: string; fromJid: string; messageId: string }) => void,
  ): () => void;
  on(event: 'occupants', cb: (e: { roomJid: string; occupants: Occupant[] }) => void): () => void;
  on(event: 'presence', cb: (e: PresenceEvent) => void): () => void;
  on(event: 'error', cb: (e: { message: string }) => void): () => void;
}
