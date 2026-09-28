import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { renderApp } from '@/test/renderApp';
import { ConnectionsPage } from './ConnectionsPage';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const openaiConnection = {
  id: 'c-1',
  provider: 'openai',
  label: 'Work',
  status: 'active',
  createdAt: '2026-09-28T00:00:00.000Z',
};

// The page is reached through the router, and its Back button navigates, so
// every render needs a router; the second route proves where Back lands.
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/settings/connections']}>
      <Routes>
        <Route path="/settings/connections" element={<ConnectionsPage />} />
        <Route path="/" element={<div>Chat list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConnectionsPage', () => {
  it('renders the empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));

    renderPage();

    expect(await screen.findByText('No provider connections yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a connection' })).toBeTruthy();
  });

  it('renders the list of connections with their provider, status and actions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [openaiConnection])));

    renderPage();

    expect(await screen.findByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('Work')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Test OpenAI key' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove OpenAI connection' })).toBeTruthy();
  });

  it('renders the error state with the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(500, { error: { message: 'boom' } })),
    );

    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('boom');
  });

  it('shows the connections-unavailable message when the server has no key configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(503, {
          error: { message: 'Provider connections are not configured on this server' },
        }),
      ),
    );

    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'Provider connections are not configured on this server',
    );
  });

  it('reveals and hides the API key input', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));

    const input = screen.getByLabelText('API key');
    expect(input.getAttribute('type')).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Show key' }));
    expect(input.getAttribute('type')).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide key' }));
    expect(input.getAttribute('type')).toBe('password');
  });

  it('does not send an empty key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Paste your API key'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial list load
  });

  it('returns to the chat list with the Back button', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));

    renderPage();

    await screen.findByText('No provider connections yet');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText('Chat list')).toBeTruthy();
  });

  it('navigates to the Connections page from the main menu', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));

    renderApp('/');

    fireEvent.click(screen.getByLabelText('Open menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Connections' }));

    expect(await screen.findByRole('heading', { name: 'Connections' })).toBeTruthy();
    expect(await screen.findByText('No provider connections yet')).toBeTruthy();
  });

  it('does not delete a connection until the removal is confirmed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [openaiConnection]));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove OpenAI connection' }));

    // The row swapped to a two-step confirm; nothing was sent yet.
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(jsonResponse(204, null));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('OpenAI')).toBeNull());
  });

  it('keeps the row and shows the server message when removal fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [openaiConnection]))
      .mockResolvedValueOnce(
        jsonResponse(500, { error: { message: 'Could not remove the connection' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove OpenAI connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Could not remove the connection')).toBeTruthy();
    expect(screen.getByText('OpenAI')).toBeTruthy();
  });
});
