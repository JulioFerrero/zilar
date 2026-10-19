import { describe, expect, it, vi } from 'vitest';
import type { ActionContext, ActionAdapter } from '../actions/registry';
import { buildWebToolsAdapters } from '../startup/components';
import { DEEPSEEK_SEARCH_URL } from './deepseek';
import type { BuildWebToolsAdaptersDeps } from './shared';

const KEY = 'sk-deepseek-test-key-do-not-leak';
const BODY_SECRET = 'Incorrect API key provided';

function context(aiId: string): ActionContext {
  return { aiId, groupId: null, topicId: null, requestId: `req-${aiId}` };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function adapters(deps: BuildWebToolsAdaptersDeps = {}): Record<string, ActionAdapter<unknown>> {
  const built = buildWebToolsAdapters({
    searchProviderName: 'duckduckgo-html',
    searchProvider: { search: async () => [] },
    rateLimitNow: () => 0,
    ...deps,
  });
  return Object.fromEntries(built.map((adapter) => [adapter.name, adapter]));
}

describe('DeepSeek web tools', () => {
  it('answers a fixed 401 summary without echoing the key or the response body', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { message: `${BODY_SECRET}: ${KEY}`, detail: 'remote body text' } },
        401,
      ),
    );
    const tools = adapters({
      deepseekKeyFor: async () => KEY,
      deepseekFetch: fetchImpl,
    });
    const search = await tools['web.search']?.execute(context('ai-401-search'), {
      query: 'today headlines',
    });
    const fetched = await tools['web.fetch']?.execute(context('ai-401-fetch'), {
      url: 'https://example.com/story',
    });

    expect(search?.summary).toBe('DeepSeek key rejected');
    expect(fetched?.summary).toBe('DeepSeek key rejected');
    const exposed = [
      search?.summary ?? '',
      search?.modelText ?? '',
      fetched?.summary ?? '',
      fetched?.modelText ?? '',
    ].join('\n');
    expect(exposed).not.toContain(KEY);
    expect(exposed).not.toContain(BODY_SECRET);
    expect(exposed).not.toContain('remote body text');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('records the tool cost once for results and never for an empty list', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        results: [
          {
            title: 'Today in the world',
            url: 'https://news.example/story',
            snippet: 'short',
            summary: 'A model-ready summary of the story.',
            date: '2026-10-19',
            site_name: 'News Example',
          },
        ],
      }),
    );
    const recordToolCost = vi.fn();
    const tools = adapters({
      deepseekKeyFor: async () => KEY,
      deepseekFetch: fetchImpl,
      recordToolCost,
    });
    const ctx = context('ai-cost');

    const withResults = await tools['web.search']?.execute(ctx, { query: 'today headlines' });
    expect(withResults?.modelText).toContain('A model-ready summary of the story.');
    expect(withResults?.modelText).toContain('News Example');
    expect(withResults?.modelText).toContain('2026-10-19');
    expect(recordToolCost).toHaveBeenCalledTimes(1);
    expect(recordToolCost).toHaveBeenCalledWith('ai-cost', 0.00075);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    fetchImpl.mockResolvedValueOnce(jsonResponse({ results: [] }));
    const empty = await tools['web.search']?.execute(ctx, { query: 'nothing at all' });
    expect(empty?.summary).toBe('search unavailable right now');
    expect(recordToolCost).toHaveBeenCalledTimes(1);
  });

  it('never calls api.deepseek.com for an AI without a DeepSeek key', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
      throw new Error('must not run');
    });
    const tools = adapters({
      deepseekKeyFor: async () => null,
      deepseekFetch: fetchImpl,
    });

    const result = await tools['web.search']?.execute(context('ai-keyless'), {
      query: 'today headlines',
    });
    expect(result?.summary).toBe('search unavailable right now');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.some(([url]) => String(url) === DEEPSEEK_SEARCH_URL)).toBe(false);
  });

  it('stops an in-flight fetch when the turn aborts, without recording a cost', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const recordToolCost = vi.fn();
    const tools = adapters({
      deepseekKeyFor: async () => KEY,
      deepseekFetch: fetchImpl,
      recordToolCost,
    });
    const controller = new AbortController();
    const ctx: ActionContext = { ...context('ai-abort'), signal: controller.signal };

    const pending = tools['web.fetch']?.execute(ctx, { url: 'https://example.com/slow' });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const abortedAt = Date.now();
    controller.abort();
    const result = await pending;

    expect(Date.now() - abortedAt).toBeLessThan(1000);
    expect(result?.summary).toBe('fetch failed');
    expect(result?.modelText).toBeUndefined();
    expect(recordToolCost).not.toHaveBeenCalled();
  });
});
