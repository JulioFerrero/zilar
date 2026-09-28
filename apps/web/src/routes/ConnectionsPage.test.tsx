import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConnectionsPage } from './ConnectionsPage';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConnectionsPage', () => {
  it('renders the empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));

    render(<ConnectionsPage />);

    expect(await screen.findByText('No provider connections yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a connection' })).toBeTruthy();
  });

  it('renders the list of connections with their provider, status and actions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, [
          {
            id: 'c-1',
            provider: 'openai',
            label: 'Work',
            status: 'active',
            createdAt: '2026-09-28T00:00:00.000Z',
          },
        ]),
      ),
    );

    render(<ConnectionsPage />);

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

    render(<ConnectionsPage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('boom');
  });

  it('reveals and hides the API key input', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [])));

    render(<ConnectionsPage />);

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

    render(<ConnectionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add a connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Paste your API key'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial list load
  });
});
