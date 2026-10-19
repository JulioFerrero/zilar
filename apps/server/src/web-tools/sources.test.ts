import { describe, expect, it, vi } from 'vitest';
import type { ActionContext, ActionAdapter } from '../actions/registry';
import { buildWebToolsAdapters } from '../startup/components';
import { DEEPSEEK_SEARCH_URL, webSource } from './sources';
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
      webSourceFor: async () => webSource('deepseek', KEY),
      sourceFetch: fetchImpl,
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
      webSourceFor: async () => webSource('deepseek', KEY),
      sourceFetch: fetchImpl,
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
      webSourceFor: async () => null,
      sourceFetch: fetchImpl,
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
      webSourceFor: async () => webSource('deepseek', KEY),
      sourceFetch: fetchImpl,
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

  it('sends each web search key only in its provider header and maps one result', async () => {
    interface ProviderCase {
      provider: string;
      label: string;
      header: string;
      headerValue: string;
      searchUrl: string;
      searchBody: unknown;
      readUrl?: string;
      readBody?: unknown;
      content?: string;
    }

    const cases: ProviderCase[] = [
      {
        provider: 'brave',
        label: 'Brave Search',
        header: 'x-subscription-token',
        headerValue: KEY,
        searchUrl: 'https://api.search.brave.com/res/v1/web/search?q=zilar&count=8',
        searchBody: {
          web: {
            results: [
              {
                title: 'Brave result',
                url: 'https://example.com/story',
                description: '<strong>Brave</strong> snippet',
              },
            ],
          },
        },
      },
      {
        provider: 'exa',
        label: 'Exa',
        header: 'x-api-key',
        headerValue: KEY,
        searchUrl: 'https://api.exa.ai/search',
        searchBody: {
          results: [
            {
              title: 'Exa result',
              url: 'https://example.com/story',
              highlights: ['First', 'second'],
            },
          ],
        },
        readUrl: 'https://api.exa.ai/contents',
        readBody: { results: [{ title: 'Exa page', text: 'Exa content' }] },
        content: 'Exa content',
      },
      {
        provider: 'firecrawl',
        label: 'Firecrawl',
        header: 'authorization',
        headerValue: `Bearer ${KEY}`,
        searchUrl: 'https://api.firecrawl.dev/v2/search',
        searchBody: {
          data: {
            web: [
              {
                title: 'Firecrawl result',
                url: 'https://example.com/story',
                description: 'Firecrawl snippet',
              },
            ],
          },
        },
        readUrl: 'https://api.firecrawl.dev/v2/scrape',
        readBody: {
          data: { markdown: 'Firecrawl content', metadata: { title: ['Firecrawl page'] } },
        },
        content: 'Firecrawl content',
      },
      {
        provider: 'jina',
        label: 'Jina',
        header: 'authorization',
        headerValue: `Bearer ${KEY}`,
        searchUrl: 'https://s.jina.ai/?q=zilar',
        searchBody: {
          data: [
            {
              title: 'Jina result',
              url: 'https://example.com/story',
              description: 'Jina snippet',
              content: 'Jina body text',
            },
          ],
        },
        readUrl: 'https://r.jina.ai/https://example.com/story',
        readBody: {
          code: 200,
          data: { title: 'Jina page', url: 'https://example.com/story', content: 'Jina content' },
        },
        content: 'Jina content',
      },
      {
        provider: 'tavily',
        label: 'Tavily',
        header: 'authorization',
        headerValue: `Bearer ${KEY}`,
        searchUrl: 'https://api.tavily.com/search',
        searchBody: {
          results: [
            { title: 'Tavily result', url: 'https://example.com/story', content: 'Tavily snippet' },
          ],
        },
        readUrl: 'https://api.tavily.com/extract',
        readBody: { results: [{ raw_content: 'Tavily content' }], failed_results: [] },
        content: 'Tavily content',
      },
    ];

    for (const testCase of cases) {
      const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        expect(headers[testCase.header]).toBe(testCase.headerValue);
        expect(url).not.toContain(KEY);
        expect(typeof init.body === 'string' ? init.body : '').not.toContain(KEY);
        return jsonResponse(url === testCase.readUrl ? testCase.readBody : testCase.searchBody);
      });
      const source = webSource(testCase.provider, KEY);
      expect(source?.label).toBe(testCase.label);

      const search = await source?.search?.('zilar', { fetchImpl });
      expect(fetchImpl.mock.calls[0]?.[0]).toBe(testCase.searchUrl);
      expect(search?.ok).toBe(true);
      if (search?.ok === true) {
        expect(search.results).toHaveLength(1);
        expect(search.results[0]?.url).toBe('https://example.com/story');
      }

      if (testCase.readUrl !== undefined) {
        const read = await source?.read?.('https://example.com/story', { fetchImpl });
        expect(fetchImpl.mock.calls[1]?.[0]).toBe(testCase.readUrl);
        expect(read?.ok).toBe(true);
        if (read?.ok === true) {
          expect(read.content).toBe(testCase.content);
        }
      } else {
        expect(source?.read).toBeUndefined();
      }

      const exposed = JSON.stringify(search);
      expect(exposed).not.toContain(KEY);
    }
  });

  it('reports a Brave 422 as a rejected key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: KEY }, 422));
    const source = webSource('brave', KEY);

    const result = await source?.search?.('zilar', { fetchImpl });

    expect(result).toEqual({ ok: false, summary: 'Brave Search key rejected' });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});
