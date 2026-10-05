import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import { AppRoutes } from '@/routes/AppRoutes';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreSeed } from '@/store/store';

export function renderApp(initialPath = '/', seed?: ChatStoreSeed, options?: { auth?: AuthState }) {
  const store = createChatStore(seed);
  const auth: AuthState = options?.auth ?? {
    status: 'authenticated',
    // T-0163: a handle by default so the handle gate does not redirect the
    // suite; pass `handle: null` explicitly to exercise the gate.
    user: {
      id: seed?.currentUserId ?? 'u-you',
      name: seed?.me?.name ?? 'You',
      email: 'you@zilar.test',
      handle: 'you',
    },
    refetch: async () => {},
  };

  const result = render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <MemoryRouter initialEntries={[initialPath]}>
          <AppRoutes />
        </MemoryRouter>
      </ChatStoreProvider>
    </AuthProvider>,
  );

  return { ...result, store };
}
