// effect-plain: a fetch, a 24 h cache, a fallback and the Effect Schema mapping.
// The models.dev catalog: caches the answer in memory for 24 h, and on any
// failure serves the last good copy or the static list. Cache prices never
// reach the public response.

import { Option, Schema } from 'effect';
import type { AiCatalog, AiCatalogModel, AiCatalogProvider } from '@zilar/api-contract';
import { modelPricesFor, setModelPrices, priceKey, type ModelPrices } from './cost';

export const MODELS_DEV_URL = 'https://models.dev/api.json';

const FETCH_TIMEOUT_MS = 10_000;
// models.dev answered with 5.6 MB on 2026-10-14, so the cap sits well above it.
const MAX_BYTES = 15 * 1024 * 1024;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// A copy of `@zilar/chat-core`'s `MODEL_SUGGESTIONS`: the server does not
// depend on that package, so the same six lists live here for the fallback.
const FALLBACK_MODEL_IDS: Record<NativeProviderId, readonly string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  xai: ['grok-4', 'grok-3', 'grok-3-mini'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro'],
};

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
// Maps the models.dev document to our catalog providers. Providers whose `npm`
// is `@ai-sdk/openai-compatible` join as `compatible`, and their base URLs stay
// server-only: only the metadata reaches the public catalog.
//
// Decoded loosely and per model: models.dev ships thousands of entries, and one
// malformed provider or model must not drop the rest.
const PROVIDERS = ['openai', 'anthropic', 'google', 'deepseek', 'xai', 'openrouter'] as const;

type NativeProviderId = (typeof PROVIDERS)[number];

const PROVIDER_NAMES: Record<NativeProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  openrouter: 'OpenRouter',
};

const NATIVE_SET: ReadonlySet<string> = new Set(PROVIDERS);

// models.dev marks every OpenAI-compatible provider with this npm package.
const COMPATIBLE_NPM = '@ai-sdk/openai-compatible';

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

const ModelsDevProvider = Schema.Struct({
  name: Schema.optional(Schema.String),
  doc: Schema.optional(Schema.String),
  npm: Schema.optional(Schema.String),
  api: Schema.optional(Schema.String),
  models: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

type ModelsDevModelType = typeof ModelsDevModel.Type;

// A model without text in and out (image, audio, embedding) is not a chat model;
// a missing `modalities` is kept because the data cannot prove otherwise.
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

// Server-only: rebuilt on every mapping and never part of the response.
const baseUrls = new Map<string, string>();

export function catalogBaseUrl(id: string): string | null {
  return baseUrls.get(id) ?? null;
}

/** Test seam: drops the compatible base URL map along with the catalog cache. */
function resetCatalogBaseUrls(): void {
  baseUrls.clear();
}

// Keeps the good chat models of one provider, newest first.
function collectModels(
  models: Readonly<Record<string, unknown>> | undefined,
): ModelsDevModelType[] {
  return Object.values(models ?? {})
    .flatMap((raw): ModelsDevModelType[] => {
      const model = Schema.decodeUnknownOption(ModelsDevModel)(raw);
      return Option.isSome(model) ? [model.value] : [];
    })
    .filter((model) => model.status !== 'deprecated' && isTextModel(model))
    .sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''));
}

function addPrices(
  prices: Map<string, ModelPrices>,
  id: string,
  models: ModelsDevModelType[],
): void {
  for (const model of models) {
    prices.set(priceKey(id, model.id), {
      inputPerMTok: model.cost?.input ?? null,
      outputPerMTok: model.cost?.output ?? null,
      cacheReadPerMTok: model.cost?.cache_read ?? null,
      cacheWritePerMTok: model.cost?.cache_write ?? null,
    });
  }
}

interface CompatibleEntry {
  id: string;
  name: string;
  docUrl: string;
  api: string;
  models: ModelsDevModelType[];
}

// Every non-native provider that speaks the OpenAI-compatible API over https,
// sorted by display name so the catalog order is stable.
function compatibleProviders(root: Record<string, unknown>): CompatibleEntry[] {
  const found: CompatibleEntry[] = [];
  for (const [id, value] of Object.entries(root)) {
    if (NATIVE_SET.has(id)) {
      continue;
    }
    const parsed = Schema.decodeUnknownOption(ModelsDevProvider)(value);
    if (Option.isNone(parsed)) {
      continue;
    }
    const { name, doc, npm, api } = parsed.value;
    if (npm !== COMPATIBLE_NPM || api === undefined || !api.startsWith('https://')) {
      continue;
    }
    const models = collectModels(parsed.value.models);
    if (models.length === 0) {
      continue;
    }
    found.push({ id, name: name ?? id, docUrl: doc ?? '', api, models });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Natives in fixed order, then compatibles by name; deprecated and non-text
 * models dropped, prices kept for the cost module.
 */
function mapCatalogDocument(raw: unknown): {
  providers: AiCatalogProvider[];
  prices: Map<string, ModelPrices>;
} {
  const providers: AiCatalogProvider[] = [];
  const prices = new Map<string, ModelPrices>();
  baseUrls.clear();
  if (typeof raw !== 'object' || raw === null) {
    return { providers, prices };
  }
  const root = raw as Record<string, unknown>;
  for (const id of PROVIDERS) {
    const parsed = Schema.decodeUnknownOption(ModelsDevProvider)(root[id]);
    if (Option.isNone(parsed)) {
      continue;
    }
    const models = collectModels(parsed.value.models);
    if (models.length === 0) {
      continue;
    }
    providers.push({
      id,
      name: PROVIDER_NAMES[id],
      kind: 'native',
      docUrl: parsed.value.doc ?? '',
      models: models.map(toCatalogModel),
    });
    addPrices(prices, id, models);
  }
  for (const entry of compatibleProviders(root)) {
    providers.push({
      id: entry.id,
      name: entry.name,
      kind: 'compatible',
      docUrl: entry.docUrl,
      models: entry.models.map(toCatalogModel),
    });
    addPrices(prices, entry.id, entry.models);
    baseUrls.set(entry.id, entry.api);
  }
  return { providers, prices };
}
