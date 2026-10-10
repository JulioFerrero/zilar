import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { renderApp } from '@/test/renderApp';
import { ConnectionsPage } from './ConnectionsPage';

function jsonResponse(status: number, body: unknown): Response {
  // A real `Response`: the derived contract client reads headers and bytes.
  return new Response(status === 204 ? null : JSON.stringify(body), { status });
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
  it('renders inside the shared settings shell with the column class', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));

    const { container } = renderPage();

    expect(await screen.findByText('No provider connections yet')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Connections' })).toBeTruthy();
    expect(
      screen.getByText('Connect a provider account to use its models. API keys only for now.'),
    ).toBeTruthy();
    expect(container.querySelector('.mx-auto.max-w-2xl')).not.toBeNull();
  });

  it('renders the empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));

    renderPage();

    expect(await screen.findByText('No provider connections yet')).toBeTruthy();
    const addButton = screen.getByRole('button', { name: 'Add a connection' });
    expect(addButton).toBeTruthy();
    expect(addButton.getAttribute('data-slot')).toBe('button');
  });

  it('renders the list of connections with their provider, status and actions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [openaiConnection])));

    renderPage();

    expect(await screen.findByText('OpenAI')).toBeTruthy();
    expect(screen.getByText(/Work · Added/)).toBeTruthy();
    const testButton = screen.getByRole('button', { name: 'Test OpenAI key' });
    expect(testButton.getAttribute('title')).toBe('Test OpenAI key');
    const removeButton = screen.getByRole('button', { name: 'Remove OpenAI connection' });
    expect(removeButton.getAttribute('title')).toBe('Remove OpenAI connection');
  });

  it('renders the error state with the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(500, { error: { code: 'boom_code', message: 'boom' } })),
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
          error: {
            code: 'connections_unavailable',
            message: 'Provider connections are not configured on this server',
          },
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
    expect(input.className).toContain('well-surface');
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
    // Several requests are made; a `Response` body can be read only once.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, [])),
    );

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
        jsonResponse(500, {
          error: { code: 'remove_failed', message: 'Could not remove the connection' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove OpenAI connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Could not remove the connection')).toBeTruthy();
    expect(screen.getByText('OpenAI')).toBeTruthy();
  });
});
