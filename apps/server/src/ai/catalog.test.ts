import { beforeEach, describe, expect, it } from 'vitest';
import { getAiCatalog, resetCatalogCache } from './catalog';

function stubFetch(impl: () => Promise<Response>): typeof fetch {
  return impl as unknown as typeof fetch;
}

describe('getAiCatalog', () => {
  beforeEach(() => {
    resetCatalogCache();
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
});
