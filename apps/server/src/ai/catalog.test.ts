import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { fallbackProviders, getAiCatalog, mapCatalog, resetCatalogCache } from './catalog';

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

describe('mapCatalog', () => {
  it('lists the natives first, then the compatible providers by name', () => {
    const providers = mapCatalog(sample);

    // `groq` has no OpenAI-compatible `npm`, so it is skipped.
    expect(providers.map((provider) => provider.id)).toEqual([
      'openai',
      'anthropic',
      'google',
      'xai',
      'openrouter',
      'together',
    ]);
    expect(providers.map((provider) => provider.kind)).toEqual([
      'native',
      'native',
      'native',
      'native',
      'native',
      'compatible',
    ]);
    expect(providers[0]?.name).toBe('OpenAI');
    expect(providers[0]?.docUrl).toBe('https://platform.openai.com/docs/models');
    // `gpt-3.5-turbo` is deprecated and `o4-mini` is not in the sample.
    expect(providers[0]?.models.map((model) => model.id)).toEqual(['gpt-5.4', 'gpt-4o-mini']);
    // The TTS model outputs audio, so it is not a chat model.
    expect(providers[2]?.models.map((model) => model.id)).toEqual(['gemini-2.5-flash']);
  });

  it('keeps a compatible provider with its docs and newest-first models', () => {
    const together = mapCatalog(sample).find((provider) => provider.id === 'together');

    expect(together?.name).toBe('Together AI');
    expect(together?.kind).toBe('compatible');
    expect(together?.docUrl).toBe('https://docs.together.ai/docs/openai-api-compatibility');
    expect(together?.models.map((model) => model.id)).toEqual([
      'deepseek-ai/DeepSeek-R1',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    ]);
  });

  it('answers an empty docUrl when models.dev has no doc', () => {
    const xai = mapCatalog(sample).find((provider) => provider.id === 'xai');

    expect(xai?.docUrl).toBe('');
  });

  it('maps every field of a model', () => {
    const openai = mapCatalog(sample)[0];

    expect(openai?.models[0]).toEqual({
      id: 'gpt-5.4',
      name: 'GPT-5.4',
      contextTokens: 1050000,
      inputPricePerMTok: 2.5,
      outputPricePerMTok: 15,
      toolCalls: true,
      reasoning: true,
      releaseDate: '2026-03-05',
    });
  });

  it('answers null prices when the catalog has no cost for a model', () => {
    const openrouter = mapCatalog(sample).find((provider) => provider.id === 'openrouter');
    const bodyBuilder = openrouter?.models.find((model) => model.id === 'openrouter/bodybuilder');

    expect(bodyBuilder?.inputPricePerMTok).toBeNull();
    expect(bodyBuilder?.outputPricePerMTok).toBeNull();
    expect(bodyBuilder?.contextTokens).toBe(128000);
  });

  it('skips a malformed model instead of dropping its provider', () => {
    const providers = mapCatalog({
      openai: {
        models: {
          'gpt-5.4': { id: 'gpt-5.4', name: 'GPT-5.4', release_date: '2026-03-05' },
          'missing-name': { id: 'missing-name' },
          'not-a-model': 'nope',
          'gpt-4o-mini': { id: 'gpt-4o-mini', name: 'GPT-4o mini', release_date: '2024-07-18' },
        },
      },
    });

    expect(providers[0]?.id).toBe('openai');
    expect(providers[0]?.models.map((model) => model.id)).toEqual(['gpt-5.4', 'gpt-4o-mini']);
  });

  it('reads nothing from a document it cannot parse', () => {
    expect(mapCatalog(null)).toEqual([]);
    expect(mapCatalog('nope')).toEqual([]);
    expect(mapCatalog({})).toEqual([]);
  });
});

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
