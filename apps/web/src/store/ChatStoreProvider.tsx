import { RegistryContext, useAtomValue } from '@effect/atom-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import type { StoreApi } from '@/store/atomStore';
import { isMockMode } from '@/mock/gate';
import { createRealChatStore } from '@/store/realStore';
import { createChatStore, type ChatStoreState } from '@/store/store';

const ChatStoreContext = createContext<StoreApi<ChatStoreState> | null>(null);

// Kept exported from this path for existing callers/tests (T-0069 moved the
// decision itself to `@/mock/gate`).
export { isMockMode };

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

  return (
    <RegistryContext.Provider value={value.registry}>
      <ChatStoreContext.Provider value={value}>{children}</ChatStoreContext.Provider>
    </RegistryContext.Provider>
  );
}

export function useChatStoreApi(): StoreApi<ChatStoreState> {
  const store = useContext(ChatStoreContext);
  if (store === null) {
    throw new Error('useChatStoreApi must be used inside a ChatStoreProvider');
  }
  return store;
}

export function useChatStore(): ChatStoreState {
  return useAtomValue(useChatStoreApi().atom);
}

/**
 * Subscribes to one slice of the store. The component re-renders only when the
 * selected value changes (`Object.is`), so selectors must return stable values:
 * select raw slices and derive with `useMemo`, never build arrays or objects.
 */
export function useChatSelector<T>(selector: (state: ChatStoreState) => T): T {
  return useAtomValue(useChatStoreApi().atom, selector);
}
