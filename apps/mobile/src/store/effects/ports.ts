// effect-plain: promise-edge adapters beside the ports.
import { Context, Layer, Effect } from 'effect';
import { createXmppCore, type XmppCore, type XmppCoreOptions } from '@zilar/xmpp-core';
import type { OutgoingBytes, SessionCheck, Visibility, VoiceOut } from '@zilar/client-core/store';
import { ApiError } from '@zilar/api-contract';

import type { OfflineCachePort } from '../offline-cache';
import { createChatApi, type ChatApi, type TokenProvider } from '../../lib/chat-api';
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
import type { AttachmentUploader, PickedFile } from '../../lib/attachment-ports';
import {
  type VoicePort,
  createVoicePort,
  VoiceError,
  type ConvertedVoice,
  type RecordedVoice,
} from '../../lib/voice';
import { attachmentDataFor, classifyMobileFile } from '../../lib/attachments';

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

function pickedImageSize(file: PickedFile): { width: number; height: number } | undefined {
  const { width, height } = file;
  if (
    width === undefined ||
    height === undefined ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    return undefined;
  }
  return { width, height };
}

// The core `bytes` port over mobile's uploader and stat seams. An unknown size is stat'd once, right before the slot request (the slot API needs an exact count).
function bytesFor(deps: RealStoreDeps): OutgoingBytes {
  const uploader = deps.uploader;
  const statSize = deps.statSize;
  return {
    describe: (file) => {
      const picked = file as PickedFile;
      const kind = classifyMobileFile(picked);
      const data = attachmentDataFor(picked, '');
      return {
        kind,
        name: data.name,
        size: data.size,
        mime: data.mime,
        ...(kind === 'image' ? { localUrl: picked.uri } : {}),
      };
    },
    measure: (file) => Effect.succeed(pickedImageSize(file as PickedFile)),
    upload: (core, file, onProgress, key) =>
      Effect.tryPromise(async () => {
        const picked = file as PickedFile;
        if (uploader === undefined) {
          throw new Error('no attachment uploader is available');
        }
        const contentType = picked.mimeType === '' ? 'application/octet-stream' : picked.mimeType;
        const size =
          picked.size !== undefined
            ? picked.size
            : statSize === undefined
              ? undefined
              : await statSize(picked.uri);
        if (size === undefined) {
          throw new Error('the file size could not be read');
        }
        const slot = await core.requestUploadSlot({
          filename: attachmentDataFor(picked, '').name,
          size,
          contentType,
        });
        await uploader.upload(
          picked,
          { putUrl: slot.putUrl, headers: slot.headers },
          onProgress,
          key,
        );
        return slot.getUrl;
      }),
  };
}

function voiceOutFor(deps: RealStoreDeps): VoiceOut {
  const port = voicePortFor(deps);
  return {
    convert: (recording) =>
      Effect.tryPromise(() => port.convert(recording.bytes as RecordedVoice)).pipe(
        Effect.map((converted) => ({ durationMs: converted.durationMs, audio: converted })),
      ),
    upload: (core, audio, onProgress, key) =>
      Effect.tryPromise(() => port.upload(core, audio as ConvertedVoice, onProgress, key)),
  };
}

/** A missing token and a 401 read as gone, anything else as `unknown`, so it never signs anyone out. */
export const checkSession = (
  getToken: TokenProvider = getSessionToken,
  getMe: () => Promise<unknown>,
): Promise<SessionCheck> =>
  Effect.runPromise(
    Effect.matchEffect(
      Effect.tryPromise({
        try: () => getToken(),
        catch: (error) => error,
      }),
      {
        onFailure: () => Effect.succeed('unknown' as SessionCheck),
        onSuccess: (token) =>
          token === undefined
            ? Effect.succeed('gone' as SessionCheck)
            : Effect.matchEffect(
                Effect.tryPromise({
                  try: () => getMe(),
                  catch: (error) => error,
                }),
                {
                  onFailure: (error: unknown) =>
                    Effect.succeed(
                      error instanceof ApiError && error.status === 401
                        ? ('gone' as SessionCheck)
                        : ('unknown' as SessionCheck),
                    ),
                  onSuccess: () => Effect.succeed('valid' as SessionCheck),
                },
              ),
      },
    ),
  );

/** The dynamic import keeps this module loadable under Vitest; never rejects, so a failed import cannot leave the revoked session stuck on "Connecting…". */
export const sessionGone = (
  signOut: () => Promise<unknown> | unknown = defaultSignOut,
): Promise<void> =>
  Effect.runPromise(
    Effect.tryPromise({
      try: () => signOut() as Promise<unknown>,
      catch: (error) => error,
    }).pipe(Effect.ignore),
  );

const defaultSignOut = async (): Promise<void> => {
  const { useAuthStore } = await import('../../auth/session');
  await useAuthStore.getState().signOut();
};

export interface AppStateLike {
  current(): string;
  subscribe(handler: (state: string) => void): () => void;
}

export interface RealStoreDeps {
  api?: ChatApi;
  topicsApi?: TopicsApi;
  inviteLinksApi?: InviteLinksApi;
  rolesApi?: RolesApi;
  groupsApi?: GroupsApi;
  chatPrefsApi?: ChatPrefsApi;
  chatFoldersApi?: ChatFoldersApi;
  pinsApi?: PinsApi;
  mediaApi?: MediaApi;
  ownedAis?: { id: string; name: string }[];
  createXmpp?: (options: XmppCoreOptions) => XmppCore;
  uploader?: AttachmentUploader;
  /** The slot API needs an exact byte count, so unknown sizes are re-statted right before the request. */
  statSize?: (uri: string) => Promise<number | undefined>;
  voice?: VoicePort;
  now?: () => Date;
  appState?: AppStateLike;
  openDrafts?: OpenDraftStream;
  checkSession?: () => Promise<SessionCheck>;
  sessionGone?: () => void;
  offlineCache?: OfflineCachePort;
  sessionUserId?: () => Promise<string | undefined>;
}

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
  readonly bytes: OutgoingBytes;
  readonly voice: VoiceOut;
  readonly now: () => Date;
  readonly appState: AppStateLike;
  readonly openDrafts: OpenDraftStream;
  readonly isVisible: () => boolean;
  readonly visibility: Visibility;
  /** Runs on `background` only: `inactive` is an iOS transition. */
  readonly onBackground: (handler: () => void) => () => void;
  readonly checkSession: () => Promise<SessionCheck>;
  sessionGone: () => void;
}

export class Ports extends Context.Service<Ports, PortsShape>()('zilar/mobile/store/Ports') {}

const alwaysActive: AppStateLike = {
  current: () => 'active',
  subscribe: () => () => {},
};

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

function onBackground(appState: AppStateLike, handler: () => void): () => void {
  return appState.subscribe((state) => {
    if (state === 'background') {
      handler();
    }
  });
}

// Resource is stable per install (`zilar-<install id>`), so a replacement kicks the ghost session instead of doubling it. The reconnect watchdog gives a slow network one 15 s first chance. The `expo-secure-store` import is dynamic so this module loads under Vitest.
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
    // The install id read is async while `createXmpp` is sync: open a random resource now and bind the stable id afterwards.
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
    checkSession: deps.checkSession ?? (() => checkSession(getSessionToken, () => api.getMe())),
    sessionGone: deps.sessionGone ?? (() => void sessionGone()),
  };
}

export const PortsLive = (deps: RealStoreDeps = {}): Layer.Layer<Ports> =>
  Layer.sync(Ports, () => resolvePorts(deps));

const unavailable = <T extends object>(label: string): T =>
  new Proxy({} as T, {
    get: (_target, property) => () => {
      throw new Error(`${label}.${String(property)} is not available in this test layer`);
    },
  });

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
