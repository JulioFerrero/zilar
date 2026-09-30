import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';
import { mockRequest, resetMockApi, setMockDelay } from '@/mock/api';

// These tests run the app on the mock store and answer `/search` from the
// in-memory mock messages by stubbing fetch to the mock layer.
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

describe('message search in the chat list (mock mode)', () => {
  afterEach(() => {
    setMockDelay(150);
    vi.unstubAllGlobals();
  });

  it('shows chat-name matches first, then message hits grouped by chat', async () => {
    stubFetchToMock();
    renderApp('/');
    fireEvent.change(screen.getByLabelText('Search chats'), { target: { value: 'concert' } });
    // No chat is named "concert", so the list is empty until hits arrive.
    expect(screen.queryByText('Ana')).toBeNull();
    // The mock Ana chat mentions the concert; the hit renders its snippet.
    // (Waiting on the mark itself: the "Messages" heading also paints while
    // the request is still loading.)
    await waitFor(() =>
      expect(screen.getByText(/concert/i, { selector: '[data-search-mark]' })).toBeTruthy(),
    );
  });

  it('shows an empty state when nothing matches', async () => {
    stubFetchToMock();
    renderApp('/');
    fireEvent.change(screen.getByLabelText('Search chats'), {
      target: { value: 'zzzqqqxxx' },
    });
    await waitFor(() => expect(screen.getByText('No messages found')).toBeTruthy());
  });

  it('opens the chat at the message on click', async () => {
    stubFetchToMock();
    const { store } = renderApp('/');
    fireEvent.change(screen.getByLabelText('Search chats'), { target: { value: 'concert' } });
    await waitFor(() =>
      expect(screen.getByText(/concert/i, { selector: '[data-search-mark]' })).toBeTruthy(),
    );
    const hit = screen.getByText(/concert/i, { selector: '[data-search-mark]' });
    const button = hit.closest('button');
    expect(button).not.toBeNull();
    fireEvent.click(button!);
    await waitFor(() => expect(store.getState().activeChatId).toBe('c-ana'));
  });

  it('mock store openAtMessage resolves loaded messages and rejects ghosts', async () => {
    const { store } = renderApp('/');
    const found = await store.getState().openAtMessage('c-ana', 'ana-1');
    expect(found.id).toBe('ana-1');
    expect(store.getState().activeChatId).toBe('c-ana');
    await expect(store.getState().openAtMessage('c-ana', 'ghost')).rejects.toThrow(
      'message_not_found',
    );
  });

  it('scopes to one chat from the header and clears with the chip', async () => {
    stubFetchToMock();
    const { store } = renderApp('/');
    store.getState().setSearchChat('c-ana');
    const input = await screen.findByLabelText('Search in Ana');
    fireEvent.change(input, { target: { value: 'concert' } });
    await waitFor(() =>
      expect(screen.getByText(/concert/i, { selector: '[data-search-mark]' })).toBeTruthy(),
    );
    // The scope chip names the chat; activating it searches everywhere again.
    fireEvent.click(screen.getByRole('button', { name: /searching only in ana/i }));
    expect(store.getState().searchChat).toBeUndefined();
  });

  it('hides the Messages section when the server answers 501', async () => {
    resetMockApi();
    setMockDelay(0);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) =>
        String(url).startsWith('/api/search?')
          ? new Response(JSON.stringify({ error: { code: 'search_unavailable', message: 'no' } }), {
              status: 501,
            })
          : new Response(JSON.stringify({ error: { code: 'not_found', message: 'no' } }), {
              status: 404,
            }),
      ),
    );
    renderApp('/');
    fireEvent.change(screen.getByLabelText('Search chats'), { target: { value: 'concert' } });
    // The heading paints while loading, then disappears once 501 hides it.
    await waitFor(() => expect(screen.queryByText('Messages')).toBeNull(), { timeout: 5000 });
  });
});
