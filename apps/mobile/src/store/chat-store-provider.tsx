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
import { ENV_MOCK, ENV_NODE_ENV, isMockMode, mockToken } from '@/mock/gate';

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
import { ensurePushPair, registerNativePush, watchPushTokenRolls } from '../lib/push/native';
import { createAttachmentUploader } from '../lib/attachment-uploader';
import { createSizeReader } from '../lib/attachment-picker';
import { getSessionToken } from '../lib/session-token';
import { API_URL } from '../lib/auth';
import { clearTranscripts } from '../lib/voice-transcripts';
import type { ChatStoreState } from './types';
import type { StoreApi } from '@zilar/client-core';

const ChatStoreContext = createContext<StoreApi<ChatStoreState> | null>(null);

const rnAppState: AppStateLike = {
  current: () => AppState.currentState,
  subscribe: (handler) => {
    const subscription = AppState.addEventListener('change', (state) => handler(state));
    return () => subscription.remove();
  },
};

function sharedDeps(): Pick<RealStoreDeps, 'appState' | 'uploader' | 'statSize'> {
  return {
    appState: rnAppState,
    uploader: createAttachmentUploader(),
    // Unknown-size picks are re-statted right before the slot request.
    statSize: (uri) => createSizeReader().sizeOf(uri),
  };
}

/**
 * The mock backend is loaded behind a literal build-time condition, so Metro folds it to `false` in a release build and leaves it out of the bundle.
 */
function mockStoreDeps(): RealStoreDeps | null {
  if (process.env.NODE_ENV === 'test' || __DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { backend, mockFetch } = require('../mock/backend') as typeof import('../mock/backend');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMockUploader } = require('../mock/uploader') as typeof import('../mock/uploader');
    return {
      ...sharedDeps(),
      // The fake core's slot URL is a `data:` URL, so the real native PUT cannot work in mock mode: this one reports progress and resolves without network.
      uploader: createMockUploader(),
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

function realStoreDeps(): RealStoreDeps {
  return {
    ...sharedDeps(),
    chatPrefsApi: createChatPrefsApi(getSessionToken, fetch, API_URL),
    chatFoldersApi: createChatFoldersApi(getSessionToken, fetch, API_URL),
    pinsApi: createPinsApi(getSessionToken, fetch, API_URL),
  };
}

export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const params = useGlobalSearchParams();
  const { status } = useSession();
  // Pinned at mount, so the mode cannot flip under the store if a later route drops the `?mock` param.
  const [mock] = useState(() =>
    isMockMode(params, { dev: __DEV__, envMock: ENV_MOCK, nodeEnv: ENV_NODE_ENV }),
  );
  const [store] = useState<StoreApi<ChatStoreState>>(() =>
    createRealChatStore((mock ? mockStoreDeps() : null) ?? realStoreDeps()),
  );
  // Mock mode has no session: its status settling to `guest` must not tear the store down and lose the open chat's history.
  const active = mock || status === 'authenticated';

  useEffect(() => {
    if (!active) {
      return;
    }
    store.getState().start();
    return () => store.getState().stop();
  }, [store, active]);

  useEffect(() => {
    if (status === 'guest') {
      void clearTranscripts();
    }
  }, [status]);

  // Reconnects and wakes run a new XMPP session, whose push pair is missing (ejabberd binds the pair to the session that sent `<enable/>`); every later transition into `online` re-sends the saved pair, which also retries a failed first enable.
  useEffect(() => {
    if (!active || mock) {
      return;
    }
    const setPushPair = store.getState().setPushPair;
    let registered = false;
    let online = false;
    const onStatus = () => {
      const nowOnline = store.getState().status === 'online';
      const entered = nowOnline && !online;
      online = nowOnline;
      if (!entered) {
        return;
      }
      if (!registered) {
        registered = true;
        void registerNativePush({ setPushPair });
        return;
      }
      void ensurePushPair({ setPushPair });
    };
    const unsubscribe = store.subscribe(onStatus);
    const tokenRolls = watchPushTokenRolls({ setPushPair });
    onStatus();
    return () => {
      unsubscribe();
      tokenRolls.remove();
    };
  }, [store, active, mock]);

  return <ChatStoreContext.Provider value={store}>{children}</ChatStoreContext.Provider>;
}

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

/** The join route resolves the just-joined group after the store refreshes chats, so it must read fresh rather than from its render-time snapshot. */
export function useChatStoreApi(): StoreApi<ChatStoreState> {
  const store = useContext(ChatStoreContext);
  if (store === null) {
    throw new Error('useChatStoreApi must be used inside ChatStoreProvider');
  }
  return store;
}
