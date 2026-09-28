import {
  client as createLibraryClient,
  type XmppClient,
  type XmppCredentialsProvider,
  type XmppElement,
  type XmppStatus,
} from '@xmpp/client';
import { jidLocalPart } from './jid';
import { DEFAULT_HISTORY_MAX, buildMamQuery, parseMamFin, toHistoryPage } from './mam';
import { installStreamManagementAck } from './stream-management';
import {
  buildAvailablePresence,
  buildCarbonsEnable,
  buildDisplayed,
  buildJoinPresence,
  buildLeavePresence,
  buildMessage,
  buildRosterError,
  buildRosterResult,
  buildTyping,
  buildUploadSlotRequest,
  decodeMessageStanza,
  isMamResult,
  mamResultQueryId,
  parseDirectInvitation,
  parseMucPresence,
  parseContactPresence,
  parseRosterPush,
  parseUploadSlot,
  stanzaErrorCondition,
  type MucPresence,
  type ParseContext,
  type RosterPush,
} from './stanza';
import type {
  ChatKind,
  ChatMessage,
  ConnectionStatus,
  DisplayedEvent,
  ErrorEvent,
  HistoryPage,
  InvitedEvent,
  LoadHistoryOptions,
  Occupant,
  OccupantsEvent,
  PresenceEvent,
  RosterEvent,
  SendMessageOptions,
  TypingEvent,
  UploadRequest,
  UploadSlot,
  XmppCore,
  XmppCoreOptions,
} from './types';

const CONNECT_TIMEOUT_MS = 15_000;
const JOIN_TIMEOUT_MS = 15_000;
const HISTORY_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 15_000;

export type ClientOptions = {
  service: string;
  domain: string;
  credentials: XmppCredentialsProvider;
  resource: string;
};

export type ClientFactory = (options: ClientOptions) => XmppClient;

export type CoreDependencies = {
  createClient?: ClientFactory;
  now?: () => Date;
  generateId?: () => string;
};

type EventPayload = {
  status: ConnectionStatus;
  message: ChatMessage;
  typing: TypingEvent;
  displayed: DisplayedEvent;
  occupants: OccupantsEvent;
  presence: PresenceEvent;
  invited: InvitedEvent;
  roster: RosterEvent;
  error: ErrorEvent;
};
type EventName = keyof EventPayload;
type StoredListener = (payload: never) => void;

type PendingJoin = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PendingQuery = {
  iqId: string;
  messages: ChatMessage[];
  resolve: (page: HistoryPage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PendingIq = {
  resolve: (stanza: XmppElement) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let idSequence = 0;

function defaultGenerateId(): string {
  idSequence += 1;
  return `g${Date.now().toString(36)}-${idSequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function defaultResource(): string {
  return `galena-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultClientFactory(options: ClientOptions): XmppClient {
  return createLibraryClient({
    service: options.service,
    domain: options.domain,
    credentials: options.credentials,
    resource: options.resource,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSaslError(error: unknown): boolean {
  return error instanceof Error && error.name === 'SASLError';
}

function redact(text: string, secret: string): string {
  return secret === '' ? text : text.split(secret).join('[redacted]');
}

export function createCore(options: XmppCoreOptions, deps: CoreDependencies = {}): XmppCore {
  const now = deps.now ?? ((): Date => new Date());
  const generateId = deps.generateId ?? defaultGenerateId;
  const createClient = deps.createClient ?? defaultClientFactory;
  const mucDomain = `rooms.${options.domain}`;

  let currentStatus: ConnectionStatus = 'offline';
  let meJid: string | undefined;
  let desiredOnline = false;
  let hasBeenOnline = false;
  let authFailed = false;
  let latestToken: string | undefined;
  let xmpp: XmppClient | undefined;

  let connectPromise: Promise<void> | undefined;
  let settleConnect: { resolve: () => void; reject: (error: Error) => void } | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;

  const listeners = new Map<EventName, Set<StoredListener>>();
  const joinedRooms = new Map<string, string>();
  const rosters = new Map<string, Map<string, Occupant>>();
  const pendingJoins = new Map<string, PendingJoin>();
  const pendingQueries = new Map<string, PendingQuery>();
  const pendingIqs = new Map<string, PendingIq>();

  function addListener(event: EventName, listener: StoredListener): () => void {
    let set = listeners.get(event);
    if (set === undefined) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  function emitEvent<K extends EventName>(event: K, payload: EventPayload[K]): void {
    const set = listeners.get(event);
    if (set === undefined) return;
    for (const listener of set) {
      (listener as (value: EventPayload[K]) => void)(payload);
    }
  }

  function emitError(message: string): void {
    emitEvent('error', {
      message: latestToken === undefined ? message : redact(message, latestToken),
    });
  }

  function setStatus(next: ConnectionStatus): void {
    if (currentStatus === next) return;
    currentStatus = next;
    emitEvent('status', next);
  }

  function rosterFor(roomJid: string): Map<string, Occupant> {
    let roster = rosters.get(roomJid);
    if (roster === undefined) {
      roster = new Map();
      rosters.set(roomJid, roster);
    }
    return roster;
  }

  function occupantsFor(roomJid: string): Occupant[] {
    const roster = rosters.get(roomJid);
    if (roster === undefined) return [];
    const result: Occupant[] = [];
    for (const occupant of roster.values()) {
      result.push({ ...occupant });
    }
    result.sort((left, right) => left.jid.localeCompare(right.jid));
    return result;
  }

  function emitOccupants(roomJid: string): void {
    emitEvent('occupants', { roomJid, occupants: occupantsFor(roomJid) });
  }

  function clearRoster(roomJid: string): void {
    const roster = rosters.get(roomJid);
    if (roster === undefined) return;
    rosters.delete(roomJid);
    if (roster.size > 0) {
      emitEvent('occupants', { roomJid, occupants: [] });
    }
  }

  function clearAllRosters(): void {
    const roomJids: string[] = [];
    for (const roomJid of rosters.keys()) {
      roomJids.push(roomJid);
    }
    for (const roomJid of roomJids) {
      clearRoster(roomJid);
    }
  }

  function applyPresence(presence: MucPresence): void {
    const roster = rosterFor(presence.roomJid);
    if (!presence.available) {
      if (roster.delete(presence.occupantJid)) {
        emitOccupants(presence.roomJid);
      }
      return;
    }

    const occupant: Occupant = {
      jid: presence.occupantJid,
      nick: presence.nick,
      available: true,
    };
    if (presence.realJid !== undefined) occupant.realJid = presence.realJid;
    if (presence.occupantId !== undefined) occupant.occupantId = presence.occupantId;
    if (presence.affiliation !== undefined) occupant.affiliation = presence.affiliation;
    if (presence.role !== undefined) occupant.role = presence.role;
    roster.set(presence.occupantJid, occupant);
    emitOccupants(presence.roomJid);
  }

  function parseContext(): ParseContext {
    const context: ParseContext = {
      domain: options.domain,
      mucDomain,
      now,
      rosterFor: (roomJid) => rosters.get(roomJid),
      myNickFor: (roomJid) => joinedRooms.get(roomJid),
    };
    if (meJid !== undefined) context.me = meJid;
    return context;
  }

  function finishConnect(error?: Error): void {
    if (connectTimer !== undefined) {
      clearTimeout(connectTimer);
      connectTimer = undefined;
    }
    const settle = settleConnect;
    settleConnect = undefined;
    connectPromise = undefined;
    if (settle === undefined) return;
    if (error === undefined) settle.resolve();
    else settle.reject(error);
  }

  const credentials: XmppCredentialsProvider = async (authenticate, mechanisms) => {
    let fresh: { jid: string; token: string };
    try {
      fresh = await options.getToken();
    } catch (error) {
      // The thrown error reaches the client's error handler, which reports it
      // and stops reconnecting. Flag it so a failed token fetch is fatal.
      authFailed = true;
      throw error;
    }

    latestToken = fresh.token;
    const mechanism = mechanisms.includes('PLAIN') ? 'PLAIN' : mechanisms[0];
    await authenticate({ username: jidLocalPart(fresh.jid), password: fresh.token }, mechanism);
  };

  async function stopAfterFailure(): Promise<void> {
    desiredOnline = false;
    hasBeenOnline = false;
    setStatus('offline');
    meJid = undefined;
    clearAllRosters();
    rejectPendingIqs('the XMPP connection failed');
    const current = xmpp;
    if (current !== undefined) {
      try {
        await current.stop();
      } catch {
        // The stream is already failing; nothing useful to report.
      }
    }
  }

  function rejectPendingIqs(reason: string): void {
    for (const [id, pending] of pendingIqs) {
      pendingIqs.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
  }

  async function afterOnline(current: XmppClient): Promise<void> {
    await sendQuietly(current, buildAvailablePresence());
    await sendQuietly(current, buildCarbonsEnable(generateId()));
    for (const [roomJid, nick] of joinedRooms) {
      // The server sends the full occupant list when we rejoin, so drop the
      // stale roster first.
      clearRoster(roomJid);
      await sendQuietly(current, buildJoinPresence(roomJid, nick));
    }
  }

  async function sendQuietly(current: XmppClient, stanza: XmppElement): Promise<void> {
    try {
      await current.send(stanza);
    } catch (error) {
      emitError(errorMessage(error));
    }
  }

  function applyRawStatus(raw: XmppStatus): void {
    if (raw === 'online') {
      setStatus('online');
      return;
    }
    if (raw === 'offline') {
      setStatus('offline');
      return;
    }
    if (
      raw === 'connecting' ||
      raw === 'connect' ||
      raw === 'connected' ||
      raw === 'opening' ||
      raw === 'open'
    ) {
      setStatus(desiredOnline ? (hasBeenOnline ? 'reconnecting' : 'connecting') : 'offline');
      return;
    }
    setStatus(desiredOnline ? (hasBeenOnline ? 'reconnecting' : 'offline') : 'offline');
  }

  function attachHandlers(current: XmppClient): void {
    current.on('status', (raw) => {
      // xmpp.js reports the `online` status just before the `online` event
      // that carries the bound JID. Going online here would let a listener
      // query history with no identity yet, so only that event goes online.
      if (raw === 'online') return;
      applyRawStatus(raw);
    });

    current.on('online', (jid) => {
      meJid = jid.bare().toString();
      hasBeenOnline = true;
      setStatus('online');
      finishConnect();
      void afterOnline(current);
    });

    current.on('error', (error) => {
      emitError(errorMessage(error));
      if (authFailed || isSaslError(error)) {
        authFailed = false;
        finishConnect(error);
        void stopAfterFailure();
      }
    });

    current.on('stanza', (stanza) => {
      handleStanza(stanza);
    });
  }

  function ensureClient(): XmppClient {
    if (xmpp !== undefined) return xmpp;
    const created = createClient({
      service: options.service,
      domain: options.domain,
      credentials,
      resource: defaultResource(),
    });
    attachHandlers(created);
    installStreamManagementAck(created);
    xmpp = created;
    return created;
  }

  function handleStanza(stanza: XmppElement): void {
    if (stanza.is('message')) {
      if (isMamResult(stanza)) {
        handleMamResult(stanza);
        return;
      }
      const invited = parseDirectInvitation(stanza, options.domain, mucDomain);
      if (invited !== undefined) emitEvent('invited', invited);
      const decoded = decodeMessageStanza(stanza, parseContext());
      if (decoded.message !== undefined) emitEvent('message', decoded.message);
      if (decoded.typing !== undefined) emitEvent('typing', decoded.typing);
      if (decoded.displayed !== undefined) emitEvent('displayed', decoded.displayed);
      return;
    }
    if (stanza.is('presence')) {
      handlePresence(stanza);
      return;
    }
    if (stanza.is('iq')) {
      handleIq(stanza);
    }
  }

  function handlePresence(stanza: XmppElement): void {
    const from = stanza.attrs['from'];
    if (from !== undefined) {
      const pending = pendingJoins.get(from);
      if (pending !== undefined) {
        const type = stanza.attrs['type'];
        if (type === 'error') {
          pendingJoins.delete(from);
          clearTimeout(pending.timer);
          pending.reject(new Error(`the room rejected the join: ${stanzaErrorCondition(stanza)}`));
        } else if (type === undefined) {
          pendingJoins.delete(from);
          clearTimeout(pending.timer);
          pending.resolve();
        }
      }
    }

    // Roster data is only trusted from rooms we joined and only from the MUC
    // domain, so another sender cannot claim an identity.
    const presence = parseMucPresence(stanza, mucDomain);
    if (presence !== undefined && joinedRooms.has(presence.roomJid)) {
      applyPresence(presence);
      return;
    }

    const contact = parseContactPresence(stanza, options.domain);
    if (contact !== undefined) emitEvent('presence', contact);
  }

  function handleMamResult(stanza: XmppElement): void {
    const queryId = mamResultQueryId(stanza);
    if (queryId === undefined) return;
    const pending = pendingQueries.get(queryId);
    if (pending === undefined) return;
    const decoded = decodeMessageStanza(stanza, parseContext());
    if (decoded.message !== undefined) pending.messages.push(decoded.message);
  }

  function handleIq(stanza: XmppElement): void {
    const id = stanza.attrs['id'];
    if (id !== undefined) {
      const pending = pendingIqs.get(id);
      if (pending !== undefined) {
        pendingIqs.delete(id);
        clearTimeout(pending.timer);
        if (stanza.attrs['type'] === 'error') {
          pending.reject(new Error(`the request failed: ${stanzaErrorCondition(stanza)}`));
        } else {
          pending.resolve(stanza);
        }
        return;
      }
    }

    const rosterPush = parseRosterPush(stanza, options.domain, meJid);
    if (rosterPush !== undefined) {
      handleRosterPush(rosterPush);
      return;
    }

    if (id === undefined) return;
    for (const [queryId, pending] of pendingQueries) {
      if (pending.iqId !== id) continue;
      pendingQueries.delete(queryId);
      clearTimeout(pending.timer);
      if (stanza.attrs['type'] === 'error') {
        pending.reject(new Error(`the history query failed: ${stanzaErrorCondition(stanza)}`));
        return;
      }
      pending.resolve(toHistoryPage(pending.messages, parseMamFin(stanza)));
      return;
    }
  }

  function handleRosterPush(push: RosterPush): void {
    if (xmpp !== undefined) {
      const reply = push.trusted
        ? buildRosterResult(push.id, push.from)
        : buildRosterError(push.id, push.from);
      void xmpp.send(reply).catch((error: unknown) => {
        emitError(errorMessage(error));
      });
    }
    if (!push.trusted) return;
    for (const item of push.items) emitEvent('roster', item);
  }

  function requireOnline(): XmppClient {
    if (xmpp === undefined || currentStatus !== 'online') {
      throw new Error('the XMPP connection is not online');
    }
    return xmpp;
  }

  function connect(): Promise<void> {
    if (currentStatus === 'online') return Promise.resolve();
    if (connectPromise !== undefined) return connectPromise;

    desiredOnline = true;
    authFailed = false;
    const current = ensureClient();
    setStatus(hasBeenOnline ? 'reconnecting' : 'connecting');

    connectPromise = new Promise<void>((resolve, reject) => {
      settleConnect = { resolve, reject };
      connectTimer = setTimeout(() => {
        finishConnect(new Error('timed out connecting to XMPP'));
      }, CONNECT_TIMEOUT_MS);
    });

    void current.start().catch(() => {
      // The error event reports the failure; auto-reconnect keeps trying.
    });

    return connectPromise;
  }

  async function disconnect(): Promise<void> {
    desiredOnline = false;
    hasBeenOnline = false;
    setStatus('offline');
    finishConnect(new Error('the XMPP client was disconnected'));
    clearAllRosters();
    rejectPendingIqs('the XMPP client was disconnected');
    const current = xmpp;
    if (current !== undefined) {
      try {
        await current.stop();
      } catch {
        // Stopping an already-closed stream is not an error worth surfacing.
      }
    }
    meJid = undefined;
  }

  async function joinRoom(roomJid: string, nick: string): Promise<void> {
    const current = requireOnline();
    joinedRooms.set(roomJid, nick);
    const key = `${roomJid}/${nick}`;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingJoins.delete(key);
        reject(new Error(`timed out joining ${roomJid}`));
      }, JOIN_TIMEOUT_MS);
      pendingJoins.set(key, { resolve, reject, timer });
      current.send(buildJoinPresence(roomJid, nick)).catch((error: unknown) => {
        const pending = pendingJoins.get(key);
        if (pending === undefined) return;
        pendingJoins.delete(key);
        clearTimeout(pending.timer);
        reject(
          new Error(`could not send the join presence for ${roomJid}: ${errorMessage(error)}`),
        );
      });
    });
  }

  async function leaveRoom(roomJid: string): Promise<void> {
    const nick = joinedRooms.get(roomJid);
    joinedRooms.delete(roomJid);
    clearRoster(roomJid);
    if (nick === undefined || xmpp === undefined || currentStatus !== 'online') return;
    await sendQuietly(xmpp, buildLeavePresence(roomJid, nick));
  }

  async function sendMessage(
    to: string,
    kind: ChatKind,
    text: string,
    opts: SendMessageOptions = {},
  ): Promise<{ id: string }> {
    const current = requireOnline();
    const id = generateId();
    await current.send(
      buildMessage({ id, to, kind, text, payload: opts.payload, replyTo: opts.replyTo }),
    );
    return { id };
  }

  function sendTyping(to: string, kind: ChatKind, state: 'composing' | 'paused'): void {
    if (xmpp === undefined || currentStatus !== 'online') return;
    void xmpp.send(buildTyping({ to, kind, state })).catch((error: unknown) => {
      emitError(errorMessage(error));
    });
  }

  function markDisplayed(chatJid: string, kind: ChatKind, messageId: string): void {
    if (xmpp === undefined || currentStatus !== 'online') return;
    void xmpp.send(buildDisplayed({ chatJid, kind, messageId })).catch((error: unknown) => {
      emitError(errorMessage(error));
    });
  }

  async function loadHistory(
    chatJid: string,
    kind: ChatKind,
    opts: LoadHistoryOptions = {},
  ): Promise<HistoryPage> {
    const current = requireOnline();
    if (meJid === undefined) {
      throw new Error('the XMPP connection has no identity yet');
    }

    const queryId = generateId();
    const iqId = generateId();
    const max = opts.max ?? DEFAULT_HISTORY_MAX;
    const query = buildMamQuery({
      chatJid,
      kind,
      me: meJid,
      queryId,
      iqId,
      max,
      before: opts.before,
    });

    return new Promise<HistoryPage>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingQueries.delete(queryId);
        reject(new Error(`timed out loading the history of ${chatJid}`));
      }, HISTORY_TIMEOUT_MS);
      pendingQueries.set(queryId, { iqId, messages: [], resolve, reject, timer });

      current.send(query).catch((error: unknown) => {
        const pending = pendingQueries.get(queryId);
        if (pending === undefined) return;
        pendingQueries.delete(queryId);
        clearTimeout(pending.timer);
        reject(
          new Error(`could not send the history query for ${chatJid}: ${errorMessage(error)}`),
        );
      });
    });
  }

  async function requestUploadSlot(request: UploadRequest): Promise<UploadSlot> {
    const current = requireOnline();
    const id = generateId();
    const service = `upload.${options.domain}`;
    const stanza = buildUploadSlotRequest({
      id,
      service,
      filename: request.filename,
      size: request.size,
      contentType: request.contentType,
    });

    return new Promise<UploadSlot>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingIqs.delete(id);
        reject(new Error('timed out requesting an upload slot'));
      }, UPLOAD_TIMEOUT_MS);
      pendingIqs.set(id, {
        resolve: (reply) => {
          const slot = parseUploadSlot(reply);
          if (slot === undefined) {
            reject(new Error('the upload service returned an invalid slot'));
            return;
          }
          resolve(slot);
        },
        reject,
        timer,
      });

      current.send(stanza).catch((error: unknown) => {
        const pending = pendingIqs.get(id);
        if (pending === undefined) return;
        pendingIqs.delete(id);
        clearTimeout(pending.timer);
        reject(new Error(`could not request an upload slot: ${errorMessage(error)}`));
      });
    });
  }

  return {
    status: () => currentStatus,
    me: () => meJid,
    connect,
    disconnect,
    joinRoom,
    leaveRoom,
    occupants: occupantsFor,
    sendMessage,
    loadHistory,
    requestUploadSlot,
    sendTyping,
    markDisplayed,
    on: (event: EventName, listener: StoredListener) => addListener(event, listener),
  };
}
