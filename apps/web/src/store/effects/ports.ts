import { summariesFor } from './chatRows';
import type { ApiClient, StorageLike } from './portTypes';
import { fromPromise } from './util';
import {
  addGroupAi as addGroupAiRequest,
  archiveTopic as archiveTopicRequest,
  addTopicAi as addTopicAiRequest,
  addTopicMember as addTopicMemberRequest,
  changeGroupMemberRole as changeGroupMemberRoleRequest,
  clearChatHistory as clearChatHistoryRequest,
  createGroup as createGroupRequest,
  createGroupInviteLink as createGroupInviteLinkRequest,
  createInvite as createInviteRequest,
  createTopic as createTopicRequest,
  deleteMessageForMe as deleteMessageForMeRequest,
  getChats,
  getChatBackgroundDefault as getChatBackgroundDefaultRequest,
  getContacts,
  getGroup,
  getMe,
  getTopic as getTopicRequest,
  getXmppToken,
  joinByLink as joinByLinkRequest,
  joinPublicGroup as joinPublicGroupRequest,
  joinTopic as joinTopicRequest,
  listAis as listAisRequest,
  listChatPrefs as listChatPrefsRequest,
  listGroupInviteLinks as listGroupInviteLinksRequest,
  listGroupMembers as listGroupMembersRequest,
  listGroupTopics as listGroupTopicsRequest,
  lookupGroupByHandle as lookupGroupByHandleRequest,
  listPins as listPinsRequest,
  markChatDelivered as markChatDeliveredRequest,
  markChatRead as markChatReadRequest,
  listChatMedia as listChatMediaRequest,
  listTopicAis as listTopicAisRequest,
  listTopicMembers as listTopicMembersRequest,
  patchTopic as patchTopicRequest,
  pinMessage as pinMessageRequest,
  previewJoinLink as previewJoinLinkRequest,
  putChatBackgroundDefault as putChatBackgroundDefaultRequest,
  putChatPref as putChatPrefRequest,
  removeGroupAi as removeGroupAiRequest,
  removeGroupMember as removeGroupMemberRequest,
  removeTopicAi as removeTopicAiRequest,
  removeTopicMember as removeTopicMemberRequest,
  revokeGroupInviteLink as revokeGroupInviteLinkRequest,
  searchDirectory as searchDirectoryRequest,
  setGroupBackground as setGroupBackgroundRequest,
  setGroupListener as setGroupListenerRequest,
  setGroupVisibility as setGroupVisibilityRequest,
  setMembersCanCreateTopics as setMembersCanCreateTopicsRequest,
  setTopicRoles as setTopicRolesRequest,
  unpinMessage as unpinMessageRequest,
  type ChatEntry,
} from '@/lib/api';
import { defaultAttachmentPort, type AttachmentPort, cleanFilename } from '@/lib/attachments';
import { authClient } from '@/lib/auth';
import { resetHandleGateDismissal } from '@/lib/handleGate';
import { dismissChatNotifications, updateAppBadge } from '@/lib/push';
import { totalBadgeUnread } from '@zilar/chat-core';
import { writeStoredDevice } from '@/lib/push/deviceStorage';
import { resetIsServerOwnerCache } from '@/lib/useIsServerOwner';
import { defaultVoicePort, type VoicePort } from '@/lib/voice/convert';
import { clearChatListCache } from '@/store/chatListCache';
import { clearMessageCache } from '@/store/messageCache';
import {
  type ChatRows,
  type Notifications,
  type OpenDraftStream,
  type OutgoingBytes,
  type SessionCheck,
  type StoreFlags,
  type Visibility,
  type VoiceOut,
  type DraftHubEvent,
  decodeDraftEvent,
  draftReconnectDelay,
  createSessionCheck,
} from '@zilar/client-core/store';
import { createXmppCore, type XmppCore, type XmppCoreOptions } from '@zilar/xmpp-core';
import { Context, Effect, Layer } from 'effect';
// effect-plain: promise-edge adapters beside the ports; the pipeline starts one layer up.
export const checkSession = createSessionCheck({ getMe });

/** The storage `clearChatListCache` writes through, exposed for tests. */
export type SessionGoneStorage = StorageLike | null;

// Runs the persistent half of signOutStore (server sign-out, cache clears, push-device
// clear so the next account re-registers) and leaves for /login. The <disable/> stanza
// cannot be sent — the XMPP connection is down — but the local handle must not survive it.
export const sessionGone = (goToLogin: () => void, storage?: SessionGoneStorage): void => {
  const target = storage === undefined ? defaultSessionGoneStorage() : storage;
  clearChatListCache(target);
  clearMessageCache(target);
  resetIsServerOwnerCache();
  resetHandleGateDismissal();
  try {
    writeStoredDevice(null);
  } catch {
    // A blocked storage must never break the sign-out.
  }
  void authClient.signOut().finally(() => {
    goToLogin();
  });
};

const defaultSessionGoneStorage = (): SessionGoneStorage => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

// effect-plain: the browser EventSource adapter behind the drafts port, a callback transport.

const DRAFT_STREAM_URL = '/api/drafts/stream';

/** The slice of EventSource the client uses. Tests inject a fake. */
interface DraftEventSource {
  /** EventSource.readyState: 2 means the browser stopped reconnecting. */
  readonly readyState: number;
  addEventListener(
    type: 'draft' | 'end' | 'error' | 'open',
    listener: (event: MessageEvent) => void,
  ): void;
  close(): void;
}

const EVENT_SOURCE_CLOSED = 2;

function defaultDraftSource(url: string): DraftEventSource {
  return new EventSource(url);
}

/** Events that fail validation are dropped silently; nothing here throws. An EventSource
 * reconnects on its own only after a dropped connection: a non-2xx response closes it for
 * good, so those are reopened with a jittered backoff (1 s -> 30 s). */
function subscribeToDrafts(
  onEvent: (event: DraftHubEvent) => void,
  createSource: (url: string) => DraftEventSource = defaultDraftSource,
  random: () => number = Math.random,
): () => void {
  let closed = false;
  let source: DraftEventSource | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  function clearRetry(): void {
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  }

  function scheduleRetry(): void {
    if (closed || retryTimer !== undefined) {
      return;
    }
    const delay = draftReconnectDelay(attempt, random);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      open();
    }, delay);
  }

  function open(): void {
    if (closed) {
      return;
    }
    let next: DraftEventSource;
    try {
      next = createSource(DRAFT_STREAM_URL);
    } catch {
      // No usable EventSource: the app simply behaves as without drafts.
      return;
    }
    source = next;

    // An open connection proves the stream is healthy, so the next retry starts at the base.
    next.addEventListener('open', () => {
      attempt = 0;
    });
    next.addEventListener('draft', (event) => {
      const parsed = decodeDraftEvent('draft', event.data);
      if (parsed !== undefined) {
        onEvent(parsed);
      }
    });
    next.addEventListener('end', (event) => {
      const parsed = decodeDraftEvent('end', event.data);
      if (parsed !== undefined) {
        onEvent(parsed);
      }
    });
    next.addEventListener('error', () => {
      // CONNECTING means the browser will reconnect by itself; only a CLOSED source needs a new one.
      if (next.readyState === EVENT_SOURCE_CLOSED) {
        next.close();
        scheduleRetry();
      }
    });
  }

  open();

  return () => {
    closed = true;
    clearRetry();
    source?.close();
  };
}

export interface RealStoreDeps {
  api?: ApiClient;
  createXmpp?: (options: XmppCoreOptions) => XmppCore;
  storage?: StorageLike | null;
  now?: () => Date;
  documentVisible?: () => boolean;
  voice?: VoicePort;
  attachments?: AttachmentPort;
  openDrafts?: OpenDraftStream;
  goToLogin?: () => void;
  checkSession?: () => Promise<SessionCheck>;
  sessionGone?: () => void;
}

export interface PortsShape {
  readonly api: ApiClient;
  readonly storage: StorageLike | null;
  readonly now: () => Date;
  readonly isVisible: () => boolean;
  readonly createXmpp: (options: XmppCoreOptions) => XmppCore;
  readonly attachments: AttachmentPort;
  readonly bytes: OutgoingBytes;
  readonly voice: VoiceOut;
  readonly openDrafts: OpenDraftStream;
  readonly goToLogin: () => void;
  readonly checkSession: () => Promise<SessionCheck>;
  /** Signs out after checkSession answered gone, so the user lands on login; the adapter
   * runs the persistent half of signOutStore and then goToLogin. */
  sessionGone: () => void;
  readonly rows: ChatRows;
  readonly visibility: Visibility;
  readonly drafts: OpenDraftStream;
  readonly notifications: Notifications;
  readonly flags: StoreFlags;
}

export class Ports extends Context.Service<Ports, PortsShape>()('zilar/web/store/Ports') {}

const realApi: ApiClient = {
  getMe,
  getChats,
  getContacts,
  getGroup,
  getXmppToken,
  markChatRead: markChatReadRequest,
  markChatDelivered: markChatDeliveredRequest,
  deleteMessageForMe: deleteMessageForMeRequest,
  clearChatHistory: clearChatHistoryRequest,
  createGroup: createGroupRequest,
  listGroupMembers: listGroupMembersRequest,
  setGroupVisibility: setGroupVisibilityRequest,
  searchDirectory: searchDirectoryRequest,
  lookupGroupByHandle: lookupGroupByHandleRequest,
  joinPublicGroup: joinPublicGroupRequest,
  createInvite: createInviteRequest,
  createGroupInviteLink: createGroupInviteLinkRequest,
  listGroupInviteLinks: listGroupInviteLinksRequest,
  revokeGroupInviteLink: revokeGroupInviteLinkRequest,
  changeGroupMemberRole: changeGroupMemberRoleRequest,
  removeGroupMember: removeGroupMemberRequest,
  previewJoinLink: previewJoinLinkRequest,
  joinByLink: joinByLinkRequest,
  listAis: listAisRequest,
  addGroupAi: addGroupAiRequest,
  removeGroupAi: removeGroupAiRequest,
  createTopic: createTopicRequest,
  getTopic: getTopicRequest,
  patchTopic: patchTopicRequest,
  archiveTopic: archiveTopicRequest,
  listGroupTopics: listGroupTopicsRequest,
  listTopicMembers: listTopicMembersRequest,
  addTopicMember: addTopicMemberRequest,
  removeTopicMember: removeTopicMemberRequest,
  joinTopic: joinTopicRequest,
  listTopicAis: listTopicAisRequest,
  addTopicAi: addTopicAiRequest,
  removeTopicAi: removeTopicAiRequest,
  setTopicRoles: setTopicRolesRequest,
  setMembersCanCreateTopics: setMembersCanCreateTopicsRequest,
  setGroupBackground: setGroupBackgroundRequest,
  setGroupListener: setGroupListenerRequest,
  listChatPrefs: listChatPrefsRequest,
  getChatBackgroundDefault: getChatBackgroundDefaultRequest,
  putChatBackgroundDefault: putChatBackgroundDefaultRequest,
  putChatPref: putChatPrefRequest,
  listPins: listPinsRequest,
  listChatMedia: listChatMediaRequest,
  pinMessage: pinMessageRequest,
  unpinMessage: unpinMessageRequest,
};

function defaultStorage(): StorageLike | null {
  return Effect.runSync(
    Effect.try(() => window.localStorage).pipe(Effect.orElseSucceed(() => null)),
  );
}

function defaultVisible(): boolean {
  if (typeof document === 'undefined') {
    return true;
  }
  // Page visibility is not enough: a visible but unfocused window (a second monitor) must
  // not mark messages seen. jsdom's document is prerender and unfocused, so treat it as visible.
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')) {
    return true;
  }
  return document.visibilityState === 'visible' && document.hasFocus();
}

function defaultOnFocus(handler: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  // Coming back into focus clears the open chat's unread; listen on both visibilitychange and
  // focus so a visible-but-unfocused window marks seen when it is clicked into.
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      handler();
    }
  };
  window.addEventListener('focus', handler);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('focus', handler);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

const realRows: ChatRows = {
  summariesFor: (entry) => summariesFor(entry as ChatEntry),
};

const webFlags: StoreFlags = { connectRetry: true, reconnectOnResume: false };

const liveNotifications: Notifications = {
  syncBadge: (chats) => {
    Effect.runFork(
      fromPromise(() => updateAppBadge(totalBadgeUnread([...chats]))).pipe(Effect.ignore),
    );
  },
  dismissChat: (chatId) => {
    Effect.runFork(fromPromise(() => dismissChatNotifications(chatId)).pipe(Effect.ignore));
  },
};

// A reload gives the next user a fresh store and XMPP connection.
function defaultGoToLogin(): void {
  if (typeof window !== 'undefined') {
    window.location.assign('/login');
  }
}

// URL.createObjectURL is missing in some test environments.
function objectUrlFor(blob: Blob): string | undefined {
  return Effect.runSync(
    Effect.try(() => URL.createObjectURL(blob)).pipe(Effect.orElseSucceed(() => undefined)),
  );
}

// The core bytes port over web's attachment port: classification, image size and the
// XEP-0363 upload. Web has no cancel and ignores progress.
function bytesFromAttachmentPort(port: AttachmentPort): OutgoingBytes {
  return {
    describe: (file) => {
      const picked = file as File;
      const kind = port.classify(picked);
      return {
        kind,
        name: cleanFilename(picked.name),
        size: picked.size,
        mime: picked.type === '' ? 'application/octet-stream' : picked.type,
        ...(kind === 'image' ? { localUrl: objectUrlFor(picked) } : {}),
      };
    },
    measure: (file) => fromPromise(() => port.readImageSize(file as File)),
    upload: (core, file) => fromPromise(() => port.upload(core, file as File)),
  };
}

// The core voice port over web's voice port; the recording's bytes are opaque to the core.
function voiceFromPort(port: VoicePort): VoiceOut {
  return {
    convert: (recording) => fromPromise(() => port.convert(recording.bytes as Blob)),
    upload: (core, audio) => fromPromise(() => port.upload(core, audio as Blob)),
  };
}

export function resolvePorts(deps: RealStoreDeps = {}): PortsShape {
  const attachments = deps.attachments ?? defaultAttachmentPort;
  return {
    api: deps.api ?? realApi,
    storage: deps.storage === undefined ? defaultStorage() : deps.storage,
    now: deps.now ?? ((): Date => new Date()),
    isVisible: deps.documentVisible ?? defaultVisible,
    createXmpp: deps.createXmpp ?? ((options: XmppCoreOptions) => createXmppCore(options)),
    voice: voiceFromPort(deps.voice ?? defaultVoicePort),
    attachments,
    bytes: bytesFromAttachmentPort(attachments),
    openDrafts: deps.openDrafts ?? subscribeToDrafts,
    goToLogin: deps.goToLogin ?? defaultGoToLogin,
    checkSession: deps.checkSession ?? checkSession,
    // The revoked session lands on sign-in through the persistent half of signOutStore
    // (server sign-out, cache and device clears, then /login).
    sessionGone: deps.sessionGone ?? (() => sessionGone(deps.goToLogin ?? defaultGoToLogin)),
    rows: realRows,
    visibility: { isVisible: deps.documentVisible ?? defaultVisible, onFocus: defaultOnFocus },
    drafts: deps.openDrafts ?? subscribeToDrafts,
    notifications: liveNotifications,
    flags: webFlags,
  };
}

export const portsLayer = (deps: RealStoreDeps = {}): Layer.Layer<Ports> =>
  Layer.sync(Ports, () => resolvePorts(deps));

export const PortsLive: Layer.Layer<Ports> = portsLayer();

function inertApi(): ApiClient {
  return new Proxy({} as ApiClient, {
    get: (_target, name) => () =>
      Promise.reject(new Error(`ApiClient.${String(name)} is not provided in this test`)),
  });
}

function inert(name: string): never {
  throw new Error(`${name} is not provided in this test`);
}

/** The ports of a test: supplied fakes win, every other port is inert. */
export function testPorts(fakes: RealStoreDeps = {}): PortsShape {
  const attachments =
    fakes.attachments ??
    ({
      classify: () => 'file',
      readImageSize: () => Promise.resolve(undefined),
      upload: () => Promise.reject(new Error('attachments are not provided in this test')),
    } as AttachmentPort);
  const voicePort =
    fakes.voice ??
    ({
      convert: () => Promise.reject(new Error('voice is not provided in this test')),
      upload: () => Promise.reject(new Error('voice is not provided in this test')),
    } as VoicePort);
  return {
    api: fakes.api ?? inertApi(),
    storage: fakes.storage === undefined ? null : fakes.storage,
    now: fakes.now ?? ((): Date => new Date(0)),
    isVisible: fakes.documentVisible ?? ((): boolean => true),
    createXmpp: fakes.createXmpp ?? (() => inert('createXmpp')),
    voice: voiceFromPort(voicePort),
    attachments,
    bytes: bytesFromAttachmentPort(attachments),
    openDrafts: fakes.openDrafts ?? (() => () => undefined),
    goToLogin: fakes.goToLogin ?? ((): void => undefined),
    checkSession: fakes.checkSession ?? (async () => 'unknown' as const),
    sessionGone: fakes.sessionGone ?? ((): void => undefined),
    rows: { summariesFor: () => [] },
    visibility: { isVisible: () => true, onFocus: () => () => undefined },
    drafts: fakes.openDrafts ?? (() => () => undefined),
    notifications: { syncBadge: () => undefined, dismissChat: () => undefined },
    flags: { connectRetry: true, reconnectOnResume: false },
  };
}

export const PortsTest = (fakes: RealStoreDeps = {}): Layer.Layer<Ports> =>
  Layer.succeed(Ports, testPorts(fakes));

/** Reads the ports of a layer once, synchronously (every layer here is sync). */
export function readPorts(layer: Layer.Layer<Ports>): PortsShape {
  return Effect.runSync(Effect.service(Ports).pipe(Effect.provide(layer)));
}
