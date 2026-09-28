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
  /**
   * Fixed XMPP resource, e.g. `gateway`. When absent, a random
   * `galena-xxxxxxxx` resource is used, as before.
   */
  resource?: string;
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
  /** True when the chat state is mine (a MUC reflection of my own state). */
  outgoing: boolean;
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
  /** True when the marker is mine (a MUC reflection of my own marker). */
  outgoing: boolean;
}

/** A direct MUC invitation (XEP-0249). */
export interface InvitedEvent {
  /** Bare JID of the room, on the MUC domain (`rooms.<domain>`). */
  roomJid: string;
  /** Bare JID of the sender, when the stanza carried one. */
  fromJid?: string;
  reason?: string;
}

export type RosterSubscription = 'none' | 'to' | 'from' | 'both' | 'remove';

/** One item of a roster push from our own server (RFC 6121 §2.1.6). */
export interface RosterEvent {
  jid: string;
  subscription: RosterSubscription;
  name?: string;
}

export interface SendMessageOptions {
  payload?: Payload;
  replyTo?: { id: string; to?: string };
}

/** A file we want to upload through XEP-0363. */
export interface UploadRequest {
  /** Original file name, shown in the download URL. */
  filename: string;
  /** Exact byte size the client is about to PUT. */
  size: number;
  /** MIME type of the bytes. */
  contentType: string;
}

/** The slot the upload service hands back (XEP-0363 §4). */
export interface UploadSlot {
  /** URL to PUT the bytes to. */
  putUrl: string;
  /** URL the receiver GETs the bytes from; this is what goes in the message. */
  getUrl: string;
  /** Extra headers the PUT must carry. */
  headers: Record<string, string>;
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
  /** Asks the HTTP upload service for a slot to PUT a file to (XEP-0363). */
  requestUploadSlot(request: UploadRequest): Promise<UploadSlot>;
  sendTyping(to: string, kind: ChatKind, state: 'composing' | 'paused'): void;
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
  /**
   * Another session logged in with the same full JID and replaced this one
   * (the `conflict` stream error). The client is already stopped with no
   * auto-reconnect when this fires.
   */
  on(event: 'replaced', cb: () => void): () => void;
}
