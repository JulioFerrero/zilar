import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { mockRequest, resetMockApi, setMockDelay } from '@/mock/api';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';
import { MessageSearchResults } from './MessageSearchResults';

// Answers `/api/search` from the in-memory mock messages, like MessageSearchList.
function stubFetchToMock(): void {
  resetMockApi();
  setMockDelay(0);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).startsWith('/api/search?')) {
        const path = String(url).replace(/^\/api/, '');
        return mockRequest(
          path,
          init?.headers === undefined
            ? { method: 'GET' }
            : { method: 'GET', headers: init.headers },
        );
      }
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'no' } }), {
        status: 404,
      });
    }),
  );
}

function PathProbe() {
  const location = useLocation();
  return <p data-testid="path">{location.pathname}</p>;
}

function renderResults(query: string, onNotFound = vi.fn()) {
  const store = createChatStore();
  const result = render(
    <AuthProvider
      value={{
        status: 'authenticated',
        user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: 'you' },
        refetch: async () => {},
      }}
    >
      <ChatStoreProvider store={store}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <MessageSearchResults query={query} onNotFound={onNotFound} />
                  <PathProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { ...result, store, onNotFound };
}

afterEach(() => {
  setMockDelay(150);
  vi.unstubAllGlobals();
});

describe('MessageSearchResults', () => {
  it('shows a loading row while the search runs', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderResults('concert');
    expect(screen.getByLabelText('Searching messages')).toBeTruthy();
    expect(screen.getByText('Searching…')).toBeTruthy();
  });

  it('shows "Couldn\'t search messages" when the server fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'server_error', message: 'boom' } }), {
            status: 500,
          }),
      ),
    );
    renderResults('concert');
    await waitFor(() => expect(screen.getByText("Couldn't search messages")).toBeTruthy());
  });

  it('shows an empty state when no message matches', async () => {
    stubFetchToMock();
    renderResults('zzzqqqxxx');
    await waitFor(() => expect(screen.getByText('No messages found')).toBeTruthy());
  });

  it('groups hits under the chat title and opens a hit on click', async () => {
    stubFetchToMock();
    const { store } = renderResults('concert');
    const hit = await waitFor(() =>
      screen.getByText(/concert/i, { selector: '[data-search-mark]' }),
    );
    expect(screen.getByText('Messages')).toBeTruthy();
    fireEvent.click(hit.closest('button')!);
    await waitFor(() => expect(store.getState().activeChatId).toBe('c-ana'));
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/c/c-ana'));
  });

  it('opens the top hit on the search Enter event', async () => {
    stubFetchToMock();
    const { store } = renderResults('concert');
    await waitFor(() =>
      expect(screen.getByText(/concert/i, { selector: '[data-search-mark]' })).toBeTruthy(),
    );
    const openAtMessage = vi.spyOn(store.getState(), 'openAtMessage');
    act(() => {
      window.dispatchEvent(new Event('zilar:search-enter'));
    });
    // The top mock hit for "concert" is Ana's message ana-1.
    await waitFor(() => expect(openAtMessage).toHaveBeenCalledWith('c-ana', 'ana-1'));
    await waitFor(() => expect(store.getState().activeChatId).toBe('c-ana'));
  });

  it('opens the top hit on Enter inside the list', async () => {
    stubFetchToMock();
    const { store } = renderResults('concert');
    await waitFor(() =>
      expect(screen.getByText(/concert/i, { selector: '[data-search-mark]' })).toBeTruthy(),
    );
    const openAtMessage = vi.spyOn(store.getState(), 'openAtMessage');
    fireEvent.keyDown(screen.getByText('Messages'), { key: 'Enter' });
    await waitFor(() => expect(openAtMessage).toHaveBeenCalledWith('c-ana', 'ana-1'));
  });

  it('reports "Message not found" and calls onNotFound when a hit cannot be opened', async () => {
    stubFetchToMock();
    const { store, onNotFound } = renderResults('concert');
    const hit = await waitFor(() =>
      screen.getByText(/concert/i, { selector: '[data-search-mark]' }),
    );
    vi.spyOn(store.getState(), 'openAtMessage').mockRejectedValue(new Error('message_not_found'));
    fireEvent.click(hit.closest('button')!);
    expect((await screen.findByRole('alert')).textContent).toBe('Message not found');
    expect(onNotFound).toHaveBeenCalledWith('c-ana');
    expect(screen.getByTestId('path').textContent).toBe('/');
  });
});
