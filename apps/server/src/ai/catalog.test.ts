import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { fallbackProviders, getAiCatalog, resetCatalogCache } from './catalog';

// A recorded sample of `https://models.dev/api.json` (2026-10-14), trimmed to
// the models the assertions need. It carries a deprecated model
// (`gpt-3.5-turbo`), a non-text model (`gemini-2.5-pro-preview-tts`, audio
// output), a model with no cost (`openrouter/bodybuilder`), a provider with no
// OpenAI-compatible `npm` (`groq`, skipped) and one compatible provider
// (`together`, T-1429).
const sample: unknown = JSON.parse(
  readFileSync(new URL('./__fixtures__/models-dev-sample.json', import.meta.url), 'utf8'),
);

function stubFetch(impl: () => Promise<Response>): typeof fetch {
  return impl as unknown as typeof fetch;
}

function failingFetch(): Promise<Response> {
  return Promise.reject(new Error('offline'));
}

describe('fallbackProviders', () => {
  it('covers all six providers with the static lists', () => {
    const providers = fallbackProviders();

    expect(providers.map((provider) => provider.id)).toEqual([
      'openai',
      'anthropic',
      'google',
      'deepseek',
      'xai',
      'openrouter',
    ]);
    expect(providers[0]?.models[0]?.id).toBe('gpt-4o');
    expect(providers[0]?.models[0]?.inputPricePerMTok).toBeNull();
    expect(providers[0]?.models.every((model) => model.toolCalls === false)).toBe(true);
  });
});

describe('getAiCatalog', () => {
  beforeEach(() => {
    resetCatalogCache();
  });

  it('serves the static list as fallback when models.dev cannot be reached', async () => {
    const catalog = await getAiCatalog({ fetchImpl: stubFetch(failingFetch), now: () => 0 });

    expect(catalog.source).toBe('fallback');
    expect(catalog.providers).toHaveLength(6);
  });

  it('accepts a body above the old 5 MB cap', async () => {
    // models.dev answered with 5.6 MB on 2026-10-14; the old 5 MB cap rejected it
    // and every cold fetch degraded to `fallback`, so keep a body that large passing.
    const padding = 'x'.repeat(5_500_000);
    const payload = { openai: { models: { 'gpt-5.4': { id: 'gpt-5.4', name: padding } } } };
    const fetchImpl = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify(payload), { status: 200 })),
    );

    const catalog = await getAiCatalog({ fetchImpl, now: () => 0 });

    expect(catalog.source).toBe('models.dev');
    expect(catalog.providers[0]?.id).toBe('openai');
  });

  it('serves the last good copy when a later fetch fails', async () => {
    const okFetch = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })),
    );
    const first = await getAiCatalog({ fetchImpl: okFetch, now: () => 0 });
    expect(first.source).toBe('models.dev');

    // Past the 24 h TTL, so the failing fetch really runs and the stale copy is served.
    const second = await getAiCatalog({
      fetchImpl: stubFetch(failingFetch),
      now: () => 24 * 60 * 60 * 1000 + 1,
    });
    expect(second.source).toBe('cache');
    expect(second.providers.map((provider) => provider.id)).toEqual(
      first.providers.map((provider) => provider.id),
    );
  });
});
