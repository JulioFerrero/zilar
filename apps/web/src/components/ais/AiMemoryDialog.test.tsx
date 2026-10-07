import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiMemoryDialog } from './AiMemoryDialog';

const CHAT = 'room-1@zilar.test';
const AI = 'a-1';
const NAME = 'Helper';

interface StubMemory {
  facts: { id: string; text: string }[];
  lines: string[];
  canChange: boolean;
}

const seeded: StubMemory = {
  facts: [{ id: 'fact-1', text: 'Julio prefers short answers.' }],
  lines: ['#0-15 Summary: the team agreed on the launch plan.'],
  canChange: true,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Component tests fake `fetch` themselves (the mock HTTP layer is off under
// `MODE=test`): an in-memory AI-memory endpoint mirroring the server contract.
function stubMemoryApi(memory: StubMemory) {
  const gets: string[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url).replace(/^\/api/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && path.startsWith('/ai-memory?')) {
      gets.push(String(url));
      return jsonResponse(200, memory);
    }
    return jsonResponse(404, { error: { code: 'not_found', message: `unexpected ${url}` } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, gets };
}

function renderDialog(onClose = vi.fn()) {
  render(<AiMemoryDialog chat={CHAT} aiId={AI} aiName={NAME} onClose={onClose} />);
  return { onClose };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AiMemoryDialog', () => {
  it('titles the dialog What <AI> remembers and loads the room memory', async () => {
    const api = stubMemoryApi(seeded);
    renderDialog();

    expect(screen.getByRole('dialog', { name: `What ${NAME} remembers` })).toBeTruthy();
    expect(await screen.findByText('Pinned facts')).toBeTruthy();

    expect(api.gets).toHaveLength(1);
    const url = new URL(api.gets[0] ?? '', 'http://localhost');
    expect(url.pathname).toBe('/api/ai-memory');
    expect(url.searchParams.get('chat')).toBe(CHAT);
    expect(url.searchParams.get('ai')).toBe(AI);
  });

  it('hides Forget and Clear when canChange is false', async () => {
    stubMemoryApi({ ...seeded, canChange: false });
    renderDialog();

    expect(await screen.findByText('Julio prefers short answers.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Forget this fact' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear memory' })).toBeNull();
  });

  it('closes with Escape', async () => {
    stubMemoryApi(seeded);
    const { onClose } = renderDialog();
    await screen.findByText('Pinned facts');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
