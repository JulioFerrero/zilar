import { Context, Layer } from 'effect';
import { createXmppCore, type XmppCore, type XmppCoreOptions } from '@zilar/xmpp-core';

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
import { createVoicePort, VoiceError, type VoicePort } from '../../lib/voice';

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
  /** The voice pipeline (T-0154); built per call, like the injected one is returned. */
  readonly voice: () => VoicePort;
  readonly now: () => Date;
  readonly appState: AppStateLike;
  readonly openDrafts: OpenDraftStream;
}

export class Ports extends Context.Service<Ports, PortsShape>()('zilar/mobile/store/Ports') {}

// The default `AppState` seam: always foreground and never changes. The app
// injects React Native's real `AppState` so a real device reconnects on resume.
const alwaysActive: AppStateLike = {
  current: () => 'active',
  subscribe: () => () => {},
};

// The voice pipeline (T-0154): conversion through `POST /api/voice` when the
// recording is not already M4A, then the XEP-0363 upload. The app wires the
// real port through the uploader seam; tests inject a fake.
function voicePortFor(deps: RealStoreDeps): VoicePort {
  if (deps.voice !== undefined) {
    return deps.voice;
  }
  const uploader = deps.uploader;
  if (uploader === undefined) {
    return {
      convert: () => Promise.reject(new VoiceError('network_error', 'Could not reach the server')),
      upload: () => Promise.reject(new VoiceError('network_error', 'Could not reach the server')),
    };
  }
  return createVoicePort({ apiUrl: API_URL, getToken: getSessionToken, uploader });
}

/** The ports a store gets: each injected dependency, else the real client. */
export function resolvePorts(deps: RealStoreDeps): PortsShape {
  const appState = deps.appState ?? alwaysActive;
  return {
    api: deps.api ?? createChatApi(getSessionToken),
    topics: deps.topicsApi ?? createTopicsApi(getSessionToken, fetch, API_URL),
    inviteLinks: deps.inviteLinksApi ?? createInviteLinksApi(getSessionToken, fetch, API_URL),
    roles: deps.rolesApi ?? createRolesApi(getSessionToken, fetch, API_URL),
    pins: deps.pinsApi ?? createPinsApi(getSessionToken, fetch, API_URL),
    media: deps.mediaApi ?? createMediaApi(getSessionToken, fetch, API_URL),
    groups: deps.groupsApi ?? createGroupsApi(getSessionToken, fetch, API_URL),
    chatPrefs: deps.chatPrefsApi,
    chatFolders: deps.chatFoldersApi,
    ownedAis: deps.ownedAis,
    createXmpp: deps.createXmpp ?? ((options: XmppCoreOptions) => createXmppCore(options)),
    uploader: deps.uploader,
    statSize: deps.statSize,
    voice: () => voicePortFor(deps),
    now: deps.now ?? ((): Date => new Date()),
    appState,
    openDrafts:
      deps.openDrafts ??
      ((onEvent) =>
        subscribeToDrafts(onEvent, {
          url: `${API_URL}${DRAFT_STREAM_PATH}`,
          getToken: getSessionToken,
          appState,
        })),
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
    voice: () => unavailable<VoicePort>('voice'),
    now: () => new Date(0),
    appState: alwaysActive,
    openDrafts: () => () => {},
    ...overrides,
  });
