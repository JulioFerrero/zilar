// T-1395: the models.dev catalog behind the wizard's model step.
//
// Fetches the public `https://models.dev/api.json` (verified 2026-10-14: 229
// providers, each `{ id, env, npm, name, doc, models }`; a model carries
// `id`, `name`, `release_date`, `reasoning`, `tool_call`, `status`,
// `modalities { input, output }`, `limit { context }` and
// `cost { input, output, cache_read, cache_write }` in USD per million
// tokens). It keeps only our six LLM providers, caches the answer in memory
// for 24 h, and on any failure serves the last good copy or the static list.
// The cache prices never reach the public catalog response; `cost.ts` reads
// them through `setModelPrices` (T-1405).

import { Option, Schema } from 'effect';
import type { AiCatalog, AiCatalogModel, AiCatalogProvider } from '@zilar/api-contract';
import { modelPricesFor, priceKey, setModelPrices, type ModelPrices } from './cost';

export const MODELS_DEV_URL = 'https://models.dev/api.json';

const FETCH_TIMEOUT_MS = 10_000;
// models.dev answered with 5.6 MB on 2026-10-14, so the cap sits well above it.
const MAX_BYTES = 15 * 1024 * 1024;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// models.dev uses the same provider ids we do, so the mapping is the identity.
const PROVIDERS = ['openai', 'anthropic', 'google', 'deepseek', 'xai', 'openrouter'] as const;

type ProviderId = (typeof PROVIDERS)[number];

const PROVIDER_NAMES: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  openrouter: 'OpenRouter',
};

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

const Modalities = Schema.Struct({
  input: Schema.optional(Schema.Array(Schema.String)),
  output: Schema.optional(Schema.Array(Schema.String)),
});

const ModelsDevModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  release_date: Schema.optional(Schema.String),
  tool_call: Schema.optional(Schema.Boolean),
  reasoning: Schema.optional(Schema.Boolean),
  status: Schema.optional(Schema.String),
  modalities: Schema.optional(Modalities),
  limit: Schema.optional(Schema.Struct({ context: Schema.optional(Schema.Number) })),
  cost: Schema.optional(
    Schema.Struct({
      input: Schema.optional(Schema.Number),
      output: Schema.optional(Schema.Number),
      cache_read: Schema.optional(Schema.Number),
      cache_write: Schema.optional(Schema.Number),
    }),
  ),
});

// The provider record is decoded loosely and each model on its own: models.dev
// ships thousands of entries, and one malformed model must not drop the rest.
const ModelsDevProvider = Schema.Struct({
  models: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

type ModelsDevModelType = typeof ModelsDevModel.Type;

// A model without a text input or a text output (an image, audio or embedding
// model) is not a chat model. A model with no `modalities` is kept: the data
// cannot prove it is not text.
function isTextModel(model: ModelsDevModelType): boolean {
  const modalities = model.modalities;
  if (modalities === undefined) {
    return true;
  }
  return (
    (modalities.input?.includes('text') ?? false) && (modalities.output?.includes('text') ?? false)
  );
}

function toCatalogModel(model: ModelsDevModelType): AiCatalogModel {
  return {
    id: model.id,
    name: model.name,
    contextTokens: model.limit?.context ?? 0,
    inputPricePerMTok: model.cost?.input ?? null,
    outputPricePerMTok: model.cost?.output ?? null,
    toolCalls: model.tool_call ?? false,
    reasoning: model.reasoning ?? false,
    releaseDate: model.release_date ?? '',
  };
}

/**
 * Maps the models.dev document to our providers, dropping deprecated and
 * non-text models and sorting each provider's models newest first, alongside
 * the per-model prices (including cache prices) the cost module keeps. An
 * unknown or missing provider is skipped.
 */
function mapCatalogDocument(raw: unknown): {
  providers: AiCatalogProvider[];
  prices: Map<string, ModelPrices>;
} {
  if (typeof raw !== 'object' || raw === null) {
    return { providers: [], prices: new Map() };
  }
  const root = raw as Record<string, unknown>;
  const providers: AiCatalogProvider[] = [];
  const prices = new Map<string, ModelPrices>();
  for (const id of PROVIDERS) {
    const parsed = Schema.decodeUnknownOption(ModelsDevProvider)(root[id]);
    if (Option.isNone(parsed)) {
      continue;
    }
    const models = Object.values(parsed.value.models ?? {})
      .flatMap((raw): ModelsDevModelType[] => {
        const model = Schema.decodeUnknownOption(ModelsDevModel)(raw);
        return Option.isSome(model) ? [model.value] : [];
      })
      .filter((model) => model.status !== 'deprecated' && isTextModel(model))
      .sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''));
    if (models.length === 0) {
      continue;
    }
    providers.push({ id, name: PROVIDER_NAMES[id], models: models.map(toCatalogModel) });
    for (const model of models) {
      prices.set(priceKey(id, model.id), {
        inputPerMTok: model.cost?.input ?? null,
        outputPerMTok: model.cost?.output ?? null,
        cacheReadPerMTok: model.cost?.cache_read ?? null,
        cacheWritePerMTok: model.cost?.cache_write ?? null,
      });
    }
  }
  return { providers, prices };
}

/**
 * The public catalog providers, exactly as the contract carries them. Pure, so
 * the test drives it with a fixture; `getAiCatalog` uses the internal mapper
 * above, which also keeps the cache prices out of this response.
 */
export function mapCatalog(raw: unknown): AiCatalogProvider[] {
  return mapCatalogDocument(raw).providers;
}

/** The static list, marked `source: 'fallback'`, when models.dev cannot be reached. */
export function fallbackProviders(): AiCatalogProvider[] {
  return PROVIDERS.map((id) => ({
    id,
    name: PROVIDER_NAMES[id],
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

/** Test seam: drops the in-memory cache. */
export function resetCatalogCache(): void {
  cache = null;
}

export interface CatalogDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * The catalog, cached for 24 h. A live fetch is `source: 'models.dev'; a fresh
 * or stale good copy on failure is `cache`; with no copy at all it is the
 * static list as `fallback`. Never rejects: the route always answers a body.
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
 * T-1405: makes the catalog prices available for cost accounting when a model
 * is not in the price map yet (a cold process, before anything fetched the
 * catalog). The fetch is shared and never rejects, so a failure just leaves
 * the price unknown and the call records cost 0. Best effort only.
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
  // Release the shared promise once it settles. Keeping the resolved promise
  // forever would price every later call for this model as 0 until a restart:
  // the warm-up may have failed (leaving the prices empty) or models.dev may
  // have added the model after the catalog cache was built. The next call
  // retries; concurrent callers still share the one in-flight request.
  return request.finally(() => {
    if (pricesRequest === request) {
      pricesRequest = null;
    }
  });
}
