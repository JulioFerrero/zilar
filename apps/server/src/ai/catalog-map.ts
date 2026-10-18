// Maps the models.dev document to our catalog providers. Providers whose `npm`
// is `@ai-sdk/openai-compatible` join as `compatible`, and their base URLs stay
// server-only: only the metadata reaches the public catalog.
//
// Decoded loosely and per model: models.dev ships thousands of entries, and one
// malformed provider or model must not drop the rest.

import { Option, Schema } from 'effect';
import type { AiCatalogModel, AiCatalogProvider } from '@zilar/api-contract';
import { priceKey, type ModelPrices } from './cost';

export const PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'openrouter',
] as const;

export type NativeProviderId = (typeof PROVIDERS)[number];

export const PROVIDER_NAMES: Record<NativeProviderId, string> = {
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
export function resetCatalogBaseUrls(): void {
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
export function mapCatalogDocument(raw: unknown): {
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
