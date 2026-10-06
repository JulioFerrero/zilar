import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiMemorySection } from './AiMemorySection';

const CHAT = 'ai-a-1@zilar.test';
const AI = 'a-1';
const NAME = 'Dev-1';

interface StubMemory {
  facts: { id: string; text: string }[];
  lines: string[];
  canChange: boolean;
}

const seeded: StubMemory = {
  facts: [
    { id: 'fact-1', text: 'Julio prefers short answers.' },
    { id: 'fact-2', text: 'The launch is on Friday.' },
  ],
  lines: [
    '#0-15 Summary: the team agreed on the launch plan.',
    '#16 2026-10-01 Julio: Let us keep the pricing simple.',
  ],
  canChange: true,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function firstOf<T>(items: T[]): T {
  const first = items[0];
  if (first === undefined) {
    throw new Error('Expected at least one item');
  }
  return first;
}

// Component tests fake `fetch` themselves (the mock HTTP layer is off under
// `MODE=test`): an in-memory AI-memory endpoint mirroring the server contract.
function stubMemoryApi(
  initial: StubMemory,
  options: { failFirstGet?: boolean; failDelete?: boolean; failClear?: boolean } = {},
) {
  let memory = initial;
  let getCount = 0;
  const deletePaths: string[] = [];
  const clearBodies: unknown[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url).replace(/^\/api/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && path.startsWith('/ai-memory?')) {
      getCount += 1;
      if (options.failFirstGet === true && getCount === 1) {
        return jsonResponse(500, { error: { code: 'boom', message: 'no' } });
      }
      return jsonResponse(200, memory);
    }
    if (method === 'DELETE' && path.startsWith('/ai-memory/facts/')) {
      deletePaths.push(path);
      if (options.failDelete === true) {
        return jsonResponse(500, { error: { code: 'boom', message: 'no' } });
      }
      const factId = decodeURIComponent(path.slice('/ai-memory/facts/'.length, path.indexOf('?')));
      memory = { ...memory, facts: memory.facts.filter((fact) => fact.id !== factId) };
      return jsonResponse(200, { ok: true });
    }
    if (method === 'POST' && path === '/ai-memory/clear') {
      clearBodies.push(init?.body === undefined ? undefined : JSON.parse(String(init.body)));
      if (options.failClear === true) {
        return jsonResponse(500, { error: { code: 'boom', message: 'no' } });
      }
      memory = { ...memory, facts: [], lines: [] };
      return jsonResponse(200, { ok: true });
    }
    return jsonResponse(404, { error: { code: 'not_found', message: `unexpected ${url}` } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    getCount: () => getCount,
    deletePaths,
    clearBodies,
  };
}

function renderSection() {
  render(<AiMemorySection chat={CHAT} aiId={AI} aiName={NAME} />);
}

async function openMemory(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Show memory' }));
  await screen.findByText('Pinned facts');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AiMemorySection', () => {
  it('makes no request until Show memory is pressed, then GETs the memory', async () => {
    const api = stubMemoryApi(seeded);
    renderSection();

    expect(api.fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Show memory' }));
    expect(await screen.findByText('Pinned facts')).toBeTruthy();

    expect(api.getCount()).toBe(1);
    const gets = api.fetchMock.mock.calls.filter(
      (call) => ((call[1] as RequestInit | undefined)?.method ?? 'GET') === 'GET',
    );
    expect(gets).toHaveLength(1);
    const url = new URL(String(firstOf(gets)[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/ai-memory');
    expect(url.searchParams.get('chat')).toBe(CHAT);
    expect(url.searchParams.get('ai')).toBe(AI);
  });

  it('shows the facts and strips the cover tokens from the lines', async () => {
    stubMemoryApi(seeded);
    renderSection();
    await openMemory();

    expect(screen.getByText('Julio prefers short answers.')).toBeTruthy();
    expect(screen.getByText('The launch is on Friday.')).toBeTruthy();
    expect(screen.getByText('Summary: the team agreed on the launch plan.')).toBeTruthy();
    expect(screen.getByText('2026-10-01 Julio: Let us keep the pricing simple.')).toBeTruthy();
    expect(screen.queryByText('#0-15 Summary: the team agreed on the launch plan.')).toBeNull();
  });

  it('forgets a fact with DELETE to the right URL and removes the row', async () => {
    const api = stubMemoryApi(seeded);
    renderSection();
    await openMemory();

    fireEvent.click(firstOf(screen.getAllByRole('button', { name: 'Forget this fact' })));

    await waitFor(() => expect(screen.queryByText('Julio prefers short answers.')).toBeNull());
    expect(screen.getByText('The launch is on Friday.')).toBeTruthy();

    expect(api.deletePaths).toHaveLength(1);
    const url = new URL(firstOf(api.deletePaths), 'http://localhost');
    expect(url.pathname).toBe('/ai-memory/facts/fact-1');
    expect(url.searchParams.get('chat')).toBe(CHAT);
    expect(url.searchParams.get('ai')).toBe(AI);
  });

  it('asks before clearing: Cancel sends nothing, Clear POSTs and reloads', async () => {
    const api = stubMemoryApi(seeded);
    renderSection();
    await openMemory();
    expect(api.getCount()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Clear memory' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Clear memory?')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.clearBodies).toHaveLength(0);
    expect(api.getCount()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Clear memory' }));
    const dialogAgain = await screen.findByRole('dialog');
    fireEvent.click(within(dialogAgain).getByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(api.clearBodies).toHaveLength(1));
    expect(api.clearBodies[0]).toEqual({ chat: CHAT, ai: AI });
    await waitFor(() => expect(api.getCount()).toBe(2));
    expect(await screen.findByText('Nothing pinned yet.')).toBeTruthy();
  });

  it('hides Forget and Clear when canChange is false', async () => {
    stubMemoryApi({ ...seeded, canChange: false });
    renderSection();
    await openMemory();

    expect(screen.getByText('Julio prefers short answers.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Forget this fact' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear memory' })).toBeNull();
  });

  it('shows the empty lines when there is no memory', async () => {
    stubMemoryApi({ facts: [], lines: [], canChange: true });
    renderSection();
    await openMemory();

    expect(screen.getByText('Nothing pinned yet.')).toBeTruthy();
    expect(screen.getByText('Nothing older than the recent messages yet.')).toBeTruthy();
  });

  it('shows Retry on error and loads again when it is pressed', async () => {
    const api = stubMemoryApi(seeded, { failFirstGet: true });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Show memory' }));
    expect(await screen.findByText('Could not load the memory')).toBeTruthy();
    expect(api.getCount()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Pinned facts')).toBeTruthy();
    expect(api.getCount()).toBe(2);
  });

  it('shows the inline alert when forgetting fails and keeps the row', async () => {
    stubMemoryApi(seeded, { failDelete: true });
    renderSection();
    await openMemory();

    fireEvent.click(firstOf(screen.getAllByRole('button', { name: 'Forget this fact' })));

    expect(await screen.findByText('Could not forget that fact')).toBeTruthy();
    expect(screen.getByText('Julio prefers short answers.')).toBeTruthy();
  });

  it('shows the inline alert when clearing fails', async () => {
    stubMemoryApi(seeded, { failClear: true });
    renderSection();
    await openMemory();

    fireEvent.click(screen.getByRole('button', { name: 'Clear memory' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));

    expect(await screen.findByText('Could not clear the memory')).toBeTruthy();
  });

  it('closes the section again with Hide memory', async () => {
    stubMemoryApi(seeded);
    renderSection();
    await openMemory();

    fireEvent.click(screen.getByRole('button', { name: 'Hide memory' }));

    expect(screen.getByRole('button', { name: 'Show memory' })).toBeTruthy();
    expect(screen.queryByText('Pinned facts')).toBeNull();
  });
});
