// effect-plain: a fetch, a 24 h cache and a fallback; the mapping (Effect Schema) lives in catalog-map.ts
// The models.dev catalog: caches the answer in memory for 24 h, and on any
// failure serves the last good copy or the static list. Cache prices never
// reach the public response; the mapping lives in `./catalog-map`.

import type { AiCatalog, AiCatalogProvider } from '@zilar/api-contract';
import { modelPricesFor, setModelPrices } from './cost';
import { PROVIDERS, PROVIDER_NAMES, mapCatalogDocument, resetCatalogBaseUrls } from './catalog-map';

export { catalogBaseUrl } from './catalog-map';

export const MODELS_DEV_URL = 'https://models.dev/api.json';

const FETCH_TIMEOUT_MS = 10_000;
// models.dev answered with 5.6 MB on 2026-10-14, so the cap sits well above it.
const MAX_BYTES = 15 * 1024 * 1024;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type ProviderId = (typeof PROVIDERS)[number];

// A copy of `@zilar/chat-core`'s `MODEL_SUGGESTIONS`: the server does not
// depend on that package, so the same six lists live here for the fallback.
const FALLBACK_MODEL_IDS: Record<ProviderId, readonly string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  xai: ['grok-4', 'grok-3', 'grok-3-mini'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro'],
};

/**
 * Public providers only; cache prices stay out of this response.
 */
export function mapCatalog(raw: unknown): AiCatalogProvider[] {
  return mapCatalogDocument(raw).providers;
}

// Offline the compatible base URLs are unknown, so only the natives are listed.
export function fallbackProviders(): AiCatalogProvider[] {
  return PROVIDERS.map((id) => ({
    id,
    name: PROVIDER_NAMES[id],
    kind: 'native' as const,
    docUrl: '',
    models: FALLBACK_MODEL_IDS[id].map((modelId) => ({
      id: modelId,
      name: modelId,
      contextTokens: 0,
      inputPricePerMTok: null,
      outputPricePerMTok: null,
      toolCalls: false,
      reasoning: false,
      releaseDate: '',
    })),
  }));
}

async function fetchCatalogJson(fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(MODELS_DEV_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`models.dev answered ${response.status}`);
  }
  const body = await readCappedBody(response, MAX_BYTES);
  if (body === null) {
    throw new Error('models.dev response is missing or over the size cap');
  }
  return JSON.parse(body) as unknown;
}

// Reads at most `cap` bytes; `null` means the body was missing or over the cap.
async function readCappedBody(response: Response, cap: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    return null;
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

let cache: { readonly catalog: AiCatalog; readonly at: number } | null = null;

// Test seam: drops the cache and the base URL map it fills, like a cold process.
export function resetCatalogCache(): void {
  cache = null;
  resetCatalogBaseUrls();
}

export interface CatalogDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Cached for 24 h; never rejects, so the route always answers a body.
 */
export async function getAiCatalog(deps: CatalogDeps = {}): Promise<AiCatalog> {
  const now = (deps.now ?? Date.now)();
  if (cache !== null && now - cache.at < CACHE_TTL_MS) {
    return { ...cache.catalog, source: 'cache' };
  }
  try {
    const document = mapCatalogDocument(await fetchCatalogJson(deps.fetchImpl ?? fetch));
    if (document.providers.length === 0) {
      throw new Error('models.dev sent no known provider');
    }
    setModelPrices(document.prices);
    const catalog: AiCatalog = {
      providers: document.providers,
      source: 'models.dev',
      fetchedAt: new Date(now).toISOString(),
    };
    cache = { catalog, at: now };
    return catalog;
  } catch {
    if (cache !== null) {
      return { ...cache.catalog, source: 'cache' };
    }
    return {
      providers: fallbackProviders(),
      source: 'fallback',
      fetchedAt: new Date(now).toISOString(),
    };
  }
}

// The in-flight price warm-up, shared so concurrent calls trigger one fetch.
let pricesRequest: Promise<void> | null = null;

/**
 * Warms prices for a model the map lacks (cold process). Shared, never rejects:
 * a failure leaves the price unknown and the call records cost 0.
 */
export function ensureModelPrices(provider: string, model: string): Promise<void> {
  if (modelPricesFor(provider, model) !== null) {
    return Promise.resolve();
  }
  pricesRequest ??= getAiCatalog().then(
    () => undefined,
    () => undefined,
  );
  const request = pricesRequest;
  // Release the promise once it settles: keeping it would price every later call
  // for this model as 0, because the warm-up may have failed or the model may
  // have been added since the cache was built.
  return request.finally(() => {
    if (pricesRequest === request) {
      pricesRequest = null;
    }
  });
}
