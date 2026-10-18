import { RegistryContext, useAtomValue } from '@effect/atom-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import type { StoreApi } from '@zilar/client-core';
import { isMockMode } from '@/mock/gate';
import { loadMockXmpp } from '@/mock/load';
import { createRealChatStore } from '@/store/realStore';
import type { ChatStoreState } from '@/store/store';
import { startSessionEnable } from '@/lib/push/sessionEnable';

const ChatStoreContext = createContext<StoreApi<ChatStoreState> | null>(null);

// Kept exported from this path for existing callers and tests; the decision lives in @/mock/gate.
export { isMockMode };

export function ChatStoreProvider({
  store,
  children,
}: {
  store?: StoreApi<ChatStoreState>;
  children: ReactNode;
}) {
  const auth = useAuth();
  // Mock mode builds its store once the fake XMPP core has loaded; a store from a test wins.
  const [created, setCreated] = useState<StoreApi<ChatStoreState> | undefined>(() =>
    store === undefined && !isMockMode() ? createRealChatStore() : undefined,
  );

  useEffect(() => {
    if (store !== undefined || !isMockMode()) {
      return;
    }
    let cancelled = false;
    void loadMockXmpp().then((createXmpp) => {
      if (!cancelled) {
        // Mock mode has no draft stream: an EventSource would 404 against vite, so the port is a no-op.
        setCreated(createRealChatStore({ createXmpp, openDrafts: () => () => undefined }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const value = store ?? created;
  const userId = auth.user?.id;
  // A different user id on a later run means an account switch: the old state resets first.
  const startedUserId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (store !== undefined || value === undefined || auth.status !== 'authenticated') {
      return;
    }
    const previousUserId = startedUserId.current;
    let cancelled = false;
    void (async () => {
      if (userId !== undefined && previousUserId !== undefined && userId !== previousUserId) {
        // switchUser resets and stops the old session, so it must settle before start boots the new one.
        await value.getState().switchUser();
      }
      if (cancelled) {
        return;
      }
      startedUserId.current = userId;
      value.getState().start();
    })();
    return () => {
      cancelled = true;
      value.getState().stop();
    };
  }, [store, value, auth.status, userId]);

  // The stored push pair belongs to a dead session after a reload, so re-send <enable/> on
  // every transition into online. Mock mode keeps nothing.
  useEffect(() => {
    if (store !== undefined || value === undefined || isMockMode()) {
      return;
    }
    return startSessionEnable(value);
  }, [store, value]);

  if (value === undefined) {
    return null;
  }

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

/** Subscribes to one slice of the store. The component re-renders only when the selected
 * value changes (Object.is), so selectors must return stable values. */
export function useChatSelector<T>(selector: (state: ChatStoreState) => T): T {
  return useAtomValue(useChatStoreApi().atom, selector);
}
