import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/routes/AppRoutes';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreSeed } from '@/store/store';

export function renderApp(initialPath = '/', seed?: ChatStoreSeed) {
  const store = createChatStore(seed);
  const result = render(
    <ChatStoreProvider store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppRoutes />
      </MemoryRouter>
    </ChatStoreProvider>,
  );

  return { ...result, store };
}
