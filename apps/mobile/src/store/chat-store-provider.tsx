import { useGlobalSearchParams } from 'expo-router';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import { useSession } from '@/auth/session';

import { createChatStore, isMockMode } from './chat-store';
import { createRealChatStore, type AppStateLike } from './real-store';
import { createChatPrefsApi } from '../lib/chat-prefs-api';
import { createPinsApi } from '../lib/pins-api';
import { createAttachmentUploader } from '../lib/attachment-native';
import { getSessionToken } from '../lib/session-token';
import { API_URL } from '../lib/auth';
import type { ChatStoreState } from './types';

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
 * Creates the real store (or the mock one when the mock gate allows `?mock=1`)
 * and starts it once the session is authenticated. Stopping on sign-out tears
 * the XMPP connection down.
 */
export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const params = useGlobalSearchParams();
  const { status } = useSession();
  const [store] = useState<StoreApi<ChatStoreState>>(() =>
    isMockMode(params, {
      dev: __DEV__,
      envMock: process.env.EXPO_PUBLIC_ZILAR_MOCK,
      nodeEnv: process.env.NODE_ENV,
    })
      ? createChatStore()
      : createRealChatStore({
          appState: rnAppState,
          chatPrefsApi: createChatPrefsApi(getSessionToken, fetch, API_URL),
          pinsApi: createPinsApi(getSessionToken, fetch, API_URL),
          uploader: createAttachmentUploader(),
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
  return useStore(store, selector);
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
