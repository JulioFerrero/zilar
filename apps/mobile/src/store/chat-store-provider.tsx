import { useGlobalSearchParams } from 'expo-router';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { useSession } from '@/auth/session';
import { ENV_MOCK, ENV_NODE_ENV, isMockMode } from '@/mock/gate';

import { createRealChatStore, type AppStateLike, type RealStoreDeps } from './real-store';
import { createChatApi } from '../lib/chat-api';
import { createTopicsApi } from '../lib/topics-api';
import { createInviteLinksApi } from '../lib/invite-links-api';
import { createRolesApi } from '../lib/roles-api';
import { createGroupsApi } from '../lib/groups-api';
import { createMediaApi } from '../lib/media-api';
import { createChatPrefsApi } from '../lib/chat-prefs-api';
import { createChatFoldersApi } from '../lib/chat-folders-api';
import { createPinsApi } from '../lib/pins-api';
import { createAttachmentUploader, createSizeReader } from '../lib/attachment-native';
import { getSessionToken } from '../lib/session-token';
import { API_URL } from '../lib/auth';
import { clearTranscripts } from '../lib/voice-transcripts';
import type { ChatStoreState } from './types';
import type { StoreApi } from './atomStore';

const ChatStoreContext = createContext<StoreApi<ChatStoreState> | null>(null);

/** React Native's `AppState`, in the shape the store listens to. */
const rnAppState: AppStateLike = {
  current: () => AppState.currentState,
  subscribe: (handler) => {
    const subscription = AppState.addEventListener('change', (state) => handler(state));
    return () => subscription.remove();
  },
};

// The token the mock-mode factories hand the API client. The shared backend
// ignores it, but the client fails `unauthorized` before sending when the token
// is `undefined` (plan risk R3).
const mockToken = (): Promise<string> => Promise.resolve('mock-token');

/** The deps both store builds share: the phone's `AppState` and the uploader. */
function sharedDeps(): Pick<RealStoreDeps, 'appState' | 'uploader' | 'statSize'> {
  return {
    appState: rnAppState,
    uploader: createAttachmentUploader(),
    // Unknown-size picks are re-statted right before the slot request (T-0157);
    // the same reader the picker defaults to.
    statSize: (uri) => createSizeReader().sizeOf(uri),
  };
}

/**
 * The real store's dependencies in mock mode (plan task H): every API factory
 * talks to the shared backend through `mockFetch`, and the fake XMPP core comes
 * from the same backend. The mock backend (and its seed) is loaded behind a
 * literal build-time condition, so Metro folds it to `false` in a release build
 * and leaves it out of the bundle. A build with `EXPO_PUBLIC_ZILAR_MOCK` keeps
 * it. Returns null when the condition is folded away.
 */
function mockStoreDeps(): RealStoreDeps | null {
  if (process.env.NODE_ENV === 'test' || __DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { backend, mockFetch } = require('../mock/backend') as typeof import('../mock/backend');
    return {
      ...sharedDeps(),
      api: createChatApi(mockToken, mockFetch, API_URL),
      topicsApi: createTopicsApi(mockToken, mockFetch, API_URL),
      inviteLinksApi: createInviteLinksApi(mockToken, mockFetch, API_URL),
      rolesApi: createRolesApi(mockToken, mockFetch, API_URL),
      groupsApi: createGroupsApi(mockToken, mockFetch, API_URL),
      chatPrefsApi: createChatPrefsApi(mockToken, mockFetch, API_URL),
      chatFoldersApi: createChatFoldersApi(mockToken, mockFetch, API_URL),
      pinsApi: createPinsApi(mockToken, mockFetch, API_URL),
      mediaApi: createMediaApi(mockToken, mockFetch, API_URL),
      createXmpp: backend.xmpp,
    };
  }
  return null;
}

/** The real store's dependencies against the real server (or a test's fetch). */
function realStoreDeps(): RealStoreDeps {
  return {
    ...sharedDeps(),
    chatPrefsApi: createChatPrefsApi(getSessionToken, fetch, API_URL),
    chatFoldersApi: createChatFoldersApi(getSessionToken, fetch, API_URL),
    pinsApi: createPinsApi(getSessionToken, fetch, API_URL),
  };
}

/**
 * Runs the real store against the shared mock backend in mock mode, else against
 * the real server. The store starts once the session is authenticated, or
 * immediately in mock mode (nobody is logged in there, plan risk R3). Stopping
 * on sign-out tears the XMPP connection down.
 */
export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const params = useGlobalSearchParams();
  const { status } = useSession();
  // Pinned at mount: the store (and its mock/real wiring) is created once, so
  // the mode must not flip under it if a later route drops the `?mock` param.
  const [mock] = useState(() =>
    isMockMode(params, { dev: __DEV__, envMock: ENV_MOCK, nodeEnv: ENV_NODE_ENV }),
  );
  const [store] = useState<StoreApi<ChatStoreState>>(() =>
    createRealChatStore((mock ? mockStoreDeps() : null) ?? realStoreDeps()),
  );
  // Mock mode has no session, so its status settling to `guest` must not tear
  // the store down and restart it: that lost the open chat's history (the
  // second start never re-opened it). `active` is stable while mock, so the
  // effect runs once there; a real session still starts on sign-in and stops on
  // sign-out.
  const active = mock || status === 'authenticated';

  useEffect(() => {
    if (!active) {
      return;
    }
    store.getState().start();
    return () => store.getState().stop();
  }, [store, active]);

  // Signing out also forgets the user scoped files on the phone (T-0901).
  useEffect(() => {
    if (status === 'guest') {
      void clearTranscripts();
    }
  }, [status]);

  return <ChatStoreContext.Provider value={store}>{children}</ChatStoreContext.Provider>;
}

/** The store hook every chat screen uses, backed by the provider. */
export function useChatStore<T>(selector: (state: ChatStoreState) => T): T {
  const store = useContext(ChatStoreContext);
  if (store === null) {
    throw new Error('useChatStore must be used inside ChatStoreProvider');
  }
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getInitialState()),
  );
}

/**
 * The raw store for call-time reads outside render (T-0136): the join route
 * resolves the just-joined group after the store refreshes chats, so it
 * must read the chats fresh rather than from its render-time snapshot.
 */
export function useChatStoreApi(): StoreApi<ChatStoreState> {
  const store = useContext(ChatStoreContext);
  if (store === null) {
    throw new Error('useChatStoreApi must be used inside ChatStoreProvider');
  }
  return store;
}
