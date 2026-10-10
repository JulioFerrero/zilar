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
import { ENV_MOCK, ENV_NODE_ENV } from '@/mock/gate';

import { createRealChatStore, type AppStateLike } from './real-store';
import { createChatPrefsApi } from '../lib/chat-prefs-api';
import { createChatFoldersApi } from '../lib/chat-folders-api';
import { createPinsApi } from '../lib/pins-api';
import { createAttachmentUploader, createSizeReader } from '../lib/attachment-native';
import { getSessionToken } from '../lib/session-token';
import { API_URL } from '../lib/auth';
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

/**
 * The mock store when the mock gate selects it, else null. The mock store (and
 * the mock data it pulls in) is loaded behind a literal build-time condition,
 * so Metro folds it to `false` in a release build and leaves it out of the
 * bundle. A build with `EXPO_PUBLIC_ZILAR_MOCK` set keeps it.
 */
function createMockStore(
  params: Record<string, string | string[] | undefined>,
): StoreApi<ChatStoreState> | null {
  if (process.env.NODE_ENV === 'test' || __DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createChatStore, isMockMode } =
      require('./chat-store') as typeof import('./chat-store');
    if (isMockMode(params, { dev: __DEV__, envMock: ENV_MOCK, nodeEnv: ENV_NODE_ENV })) {
      return createChatStore();
    }
  }
  return null;
}

/**
 * Creates the real store (or the mock one when the mock gate allows `?mock=1`)
 * and starts it once the session is authenticated. Stopping on sign-out tears
 * the XMPP connection down.
 */
export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const params = useGlobalSearchParams();
  const { status } = useSession();
  const [store] = useState<StoreApi<ChatStoreState>>(
    () =>
      createMockStore(params) ??
      createRealChatStore({
        appState: rnAppState,
        chatPrefsApi: createChatPrefsApi(getSessionToken, fetch, API_URL),
        chatFoldersApi: createChatFoldersApi(getSessionToken, fetch, API_URL),
        pinsApi: createPinsApi(getSessionToken, fetch, API_URL),
        uploader: createAttachmentUploader(),
        // Unknown-size picks are re-statted right before the slot
        // request (T-0157); the same reader the picker defaults to.
        statSize: (uri) => createSizeReader().sizeOf(uri),
      }),
  );

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    store.getState().start();
    return () => store.getState().stop();
  }, [store, status]);

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
