import { Context, Layer } from 'effect';
import { createXmppCore, type XmppCore, type XmppCoreOptions } from '@zilar/xmpp-core';
import type { OutgoingBytes, SessionCheck, Visibility, VoiceOut } from '@zilar/client-core/store';

import type { OfflineCachePort } from '../offline-cache';
import { createChatApi, type ChatApi } from '../../lib/chat-api';
import type { ChatPrefsApi } from '../../lib/chat-prefs-api';
import type { ChatFoldersApi } from '../../lib/chat-folders-api';
import { createPinsApi, type PinsApi } from '../../lib/pins-api';
import { createMediaApi, type MediaApi } from '../../lib/media-api';
import { API_URL } from '../../lib/auth';
import { createInviteLinksApi, type InviteLinksApi } from '../../lib/invite-links-api';
import { createTopicsApi, type TopicsApi } from '../../lib/topics-api';
import { createRolesApi, type RolesApi } from '../../lib/roles-api';
import { createGroupsApi, type GroupsApi } from '../../lib/groups-api';
import { DRAFT_STREAM_PATH, subscribeToDrafts, type OpenDraftStream } from '../../lib/drafts';
import { getSessionToken } from '../../lib/session-token';
import type { AttachmentUploader } from '../../lib/attachment-ports';
import type { VoicePort } from '../../lib/voice';
import { bytesFor, voiceOutFor } from './ports-media';
import {
  checkSession as checkSessionAdapter,
  sessionGone as sessionGoneAdapter,
} from './session-check';

/** The slice of React Native's `AppState` the store listens to. */
export interface AppStateLike {
  current(): string;
  subscribe(handler: (state: string) => void): () => void;
}

export interface RealStoreDeps {
  api?: ChatApi;
  topicsApi?: TopicsApi;
  /** The group invite-links API (T-0136); tests inject a fake. */
  inviteLinksApi?: InviteLinksApi;
  rolesApi?: RolesApi;
  /** The channel management API (T-0144); tests inject a fake. */
  groupsApi?: GroupsApi;
  chatPrefsApi?: ChatPrefsApi;
  /** The chat-folders API (T-0248); tests inject a fake. */
  chatFoldersApi?: ChatFoldersApi;
  pinsApi?: PinsApi;
  /** The chat media gallery API (T-0436); tests inject a fake. */
  mediaApi?: MediaApi;
  ownedAis?: { id: string; name: string }[];
  createXmpp?: (options: XmppCoreOptions) => XmppCore;
  /** Uploads picked bytes to a XEP-0363 slot (T-0150); tests inject a fake. */
  uploader?: AttachmentUploader;
  /**
   * Resolves the real byte size of a local file (T-0157): the store re-stats
   * an unknown-size pick right before the slot request, since the slot API
   * needs an exact count. Tests inject a fake; the app injects the
   * `expo-file-system` stat.
   */
  statSize?: (uri: string) => Promise<number | undefined>;
  /** Converts + uploads voice recordings (T-0154); tests inject a fake. */
  voice?: VoicePort;
  now?: () => Date;
  appState?: AppStateLike;
  /** The AI draft SSE stream; tests inject a fake. */
  openDrafts?: OpenDraftStream;
  /** Asks `GET /api/me` whether the session still exists (T-1223); tests inject a fake. */
  checkSession?: () => Promise<SessionCheck>;
  /** Signs out after `checkSession` answered `gone`; tests inject a fake. */
  sessionGone?: () => void;
  /** The offline cache file seam (T-1313); tests inject an in-memory fake. */
  offlineCache?: OfflineCachePort;
  /** Reads the signed-in user id for the offline cache owner check (T-1313). */
  sessionUserId?: () => Promise<string | undefined>;
}

/** Everything the store talks to outside itself, resolved from `RealStoreDeps`. */
export interface PortsShape {
  readonly api: ChatApi;
  readonly topics: TopicsApi;
  readonly inviteLinks: InviteLinksApi;
  readonly roles: RolesApi;
  readonly pins: PinsApi;
  readonly media: MediaApi;
  readonly groups: GroupsApi;
  readonly chatPrefs: ChatPrefsApi | undefined;
  readonly chatFolders: ChatFoldersApi | undefined;
  readonly ownedAis: { id: string; name: string }[] | undefined;
  readonly createXmpp: (options: XmppCoreOptions) => XmppCore;
  readonly uploader: AttachmentUploader | undefined;
  readonly statSize: ((uri: string) => Promise<number | undefined>) | undefined;
  /** The core send pipeline's file port (T10): classify, measure, upload. */
  readonly bytes: OutgoingBytes;
  /** The core send pipeline's voice port (T10): convert, then upload. */
  readonly voice: VoiceOut;
  readonly now: () => Date;
  readonly appState: AppStateLike;
  readonly openDrafts: OpenDraftStream;
  /** The core lifecycle's visibility port (T-0918): built from `AppState`. */
  readonly isVisible: () => boolean;
  readonly visibility: Visibility;
  /**
   * The AppState background subscription (F1): `handler` runs on `background`
   * only (`inactive` is an iOS transition and does nothing). Returns the
   * unsubscribe. Built from `appState`, beside `visibility`.
   */
  readonly onBackground: (handler: () => void) => () => void;
  /** Asks `GET /api/me` whether the session still exists after `authFailed` (T-1223). */
  readonly checkSession: () => Promise<SessionCheck>;
  /**
   * Signs out after `checkSession` answered `gone`, so the user lands on
   * login. Defaults to the session store's `signOut` (T-1223); tests
   * inject it through deps.
   */
  sessionGone: () => void;
}

export class Ports extends Context.Service<Ports, PortsShape>()('zilar/mobile/store/Ports') {}

// The default `AppState` seam: always foreground and never changes. The app
// injects React Native's real `AppState` so a real device reconnects on resume.
const alwaysActive: AppStateLike = {
  current: () => 'active',
  subscribe: () => () => {},
};

// The core visibility port over React Native's `AppState` (T-0918): a focus is
// `AppState` becoming `active`, which is what a resume is on the phone.
function visibilityFor(appState: AppStateLike): Visibility {
  return {
    isVisible: () => appState.current() === 'active',
    onFocus: (handler) =>
      appState.subscribe((state) => {
        if (state === 'active') {
          handler();
        }
      }),
  };
}

// The AppState background subscription beside `visibilityFor` (F1): the store
// suspends the XMPP session after a 10 s grace in `background`; the resume
// runs through the existing `onFocus` path. `inactive` (an iOS transition)
// does nothing.
function onBackground(appState: AppStateLike, handler: () => void): () => void {
  return appState.subscribe((state) => {
    if (state === 'background') {
      handler();
    }
  });
}

// The phone's XMPP core (F4, closes MP-11): the reconnect watchdog gets a 15 s
// first step, so a slow network gets one long chance before a stuck client is
// replaced, and the resource is stable per install (`zilar-<install id>`), so
// a replacement kicks the ghost session instead of doubling it. The install
// id is generated once and kept in SecureStore under `zilar.xmpp.resource`
// (see `auth/secure-session-storage.ts`); the `expo-secure-store` import is
// dynamic so this module can be loaded under Vitest (Node), which cannot
// import the native module. Tests inject `createXmpp` and never touch this
// path. Web builds no options here, so it is unchanged.
const XMPP_RESOURCE_KEY = 'zilar.xmpp.resource';

const MOBILE_WATCHDOG_FIRST_MS = 15_000;

let cachedResource: string | undefined;

async function secureStore(): Promise<typeof import('expo-secure-store')> {
  return import('expo-secure-store');
}

async function readInstallId(): Promise<string | undefined> {
  const raw = await (await secureStore()).getItemAsync(XMPP_RESOURCE_KEY);
  return raw === null || raw === '' ? undefined : raw;
}

function createMobileXmpp(options: XmppCoreOptions): XmppCore {
  if (cachedResource === undefined) {
    // The install id read is async while `createXmpp` is sync: start it now
    // and fall back to a per-process random resource for this one core. Every
    // later core (including the watchdog's replacements) binds the stable id.
    cachedResource = `zilar-${Math.random().toString(36).slice(2, 10)}`;
    void readInstallId().then(async (existing) => {
      if (existing !== undefined) {
        cachedResource = `zilar-${existing}`;
        return;
      }
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      await (await secureStore()).setItemAsync(XMPP_RESOURCE_KEY, id);
      cachedResource = `zilar-${id}`;
    });
  }
  return createXmppCore({
    ...options,
    reconnectWatchdogFirstMs: MOBILE_WATCHDOG_FIRST_MS,
    resource: options.resource ?? cachedResource,
  });
}

/** The ports a store gets: each injected dependency, else the real client. */
export function resolvePorts(deps: RealStoreDeps): PortsShape {
  const appState = deps.appState ?? alwaysActive;
  const api = deps.api ?? createChatApi(getSessionToken);
  return {
    api,
    topics: deps.topicsApi ?? createTopicsApi(getSessionToken, fetch, API_URL),
    inviteLinks: deps.inviteLinksApi ?? createInviteLinksApi(getSessionToken, fetch, API_URL),
    roles: deps.rolesApi ?? createRolesApi(getSessionToken, fetch, API_URL),
    pins: deps.pinsApi ?? createPinsApi(getSessionToken, fetch, API_URL),
    media: deps.mediaApi ?? createMediaApi(getSessionToken, fetch, API_URL),
    groups: deps.groupsApi ?? createGroupsApi(getSessionToken, fetch, API_URL),
    chatPrefs: deps.chatPrefsApi,
    chatFolders: deps.chatFoldersApi,
    ownedAis: deps.ownedAis,
    createXmpp: deps.createXmpp ?? createMobileXmpp,
    uploader: deps.uploader,
    statSize: deps.statSize,
    bytes: bytesFor(deps),
    voice: voiceOutFor(deps),
    now: deps.now ?? ((): Date => new Date()),
    appState,
    isVisible: () => appState.current() === 'active',
    visibility: visibilityFor(appState),
    onBackground: (handler) => onBackground(appState, handler),
    openDrafts:
      deps.openDrafts ??
      ((onEvent) =>
        subscribeToDrafts(onEvent, {
          url: `${API_URL}${DRAFT_STREAM_PATH}`,
          getToken: getSessionToken,
          appState,
        })),
    // `checkSession` asks `GET /api/me` whether the session still exists; the
    // adapter lives in `./session-check` (T-1223).
    checkSession:
      deps.checkSession ?? (() => checkSessionAdapter(getSessionToken, () => api.getMe())),
    // The revoked session lands on the sign-in screen through the session
    // store's `signOut`; the adapter lives in `./session-check` (T-1223).
    sessionGone: deps.sessionGone ?? (() => void sessionGoneAdapter()),
  };
}

/** The live layer: the injected dependencies, else the real clients. */
export const PortsLive = (deps: RealStoreDeps = {}): Layer.Layer<Ports> =>
  Layer.sync(Ports, () => resolvePorts(deps));

// A port nobody injected: any call fails loudly, like a missing server.
const unavailable = <T extends object>(label: string): T =>
  new Proxy({} as T, {
    get: (_target, property) => () => {
      throw new Error(`${label}.${String(property)} is not available in this test layer`);
    },
  });

/** A test layer: every port fails loudly unless `overrides` replaces it. */
export const PortsTest = (overrides: Partial<PortsShape> = {}): Layer.Layer<Ports> =>
  Layer.succeed(Ports, {
    api: unavailable<ChatApi>('api'),
    topics: unavailable<TopicsApi>('topics'),
    inviteLinks: unavailable<InviteLinksApi>('inviteLinks'),
    roles: unavailable<RolesApi>('roles'),
    pins: unavailable<PinsApi>('pins'),
    media: unavailable<MediaApi>('media'),
    groups: unavailable<GroupsApi>('groups'),
    chatPrefs: undefined,
    chatFolders: undefined,
    ownedAis: undefined,
    createXmpp: () => {
      throw new Error('createXmpp is not available in this test layer');
    },
    uploader: undefined,
    statSize: undefined,
    bytes: bytesFor({}),
    voice: voiceOutFor({}),
    now: () => new Date(0),
    appState: alwaysActive,
    isVisible: () => true,
    visibility: visibilityFor(alwaysActive),
    onBackground: (handler) => onBackground(alwaysActive, handler),
    openDrafts: () => () => {},
    checkSession: () =>
      Promise.reject(new Error('checkSession is not available in this test layer')),
    sessionGone: () => {
      throw new Error('sessionGone is not available in this test layer');
    },
    ...overrides,
  });
