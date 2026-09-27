import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { useAuth } from '@/auth/AuthProvider';
import { createRealChatStore } from '@/store/realStore';
import { createChatStore, type ChatStoreState } from '@/store/store';

const ChatStoreContext = createContext<StoreApi<ChatStoreState> | null>(null);

/**
 * The real store is the default. `?mock=1` (or `VITE_MOCK=1`) keeps the mock
 * store for tests and local UI work.
 */
export function isMockMode(): boolean {
  if (import.meta.env.VITE_MOCK === '1' || import.meta.env.MODE === 'test') {
    return true;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  return new URLSearchParams(window.location.search).get('mock') === '1';
}

export function ChatStoreProvider({
  store,
  children,
}: {
  store?: StoreApi<ChatStoreState>;
  children: ReactNode;
}) {
  const [created] = useState(() => (isMockMode() ? createChatStore() : createRealChatStore()));
  const value = store ?? created;
  const auth = useAuth();

  useEffect(() => {
    if (store !== undefined || auth.status !== 'authenticated') {
      return;
    }
    value.getState().start();
    return () => value.getState().stop();
  }, [store, value, auth.status]);

  return <ChatStoreContext.Provider value={value}>{children}</ChatStoreContext.Provider>;
}

export function useChatStoreApi(): StoreApi<ChatStoreState> {
  const store = useContext(ChatStoreContext);
  if (store === null) {
    throw new Error('useChatStoreApi must be used inside a ChatStoreProvider');
  }
  return store;
}

export function useChatStore(): ChatStoreState {
  return useStore(useChatStoreApi(), (state) => state);
}
