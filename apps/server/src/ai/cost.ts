// T-1405: what one model call costs, in USD, from the models.dev prices the
// catalog keeps (docs/audit/effect-ai-plan.md §5.3). The catalog is the source;
// `setModelPrices` is filled by `ai/catalog.ts` when it maps models.dev, and by
// tests. Prices are USD per million tokens, as models.dev reports them.
import type { ChatUsage } from './model-client';

export interface ModelPrices {
  inputPerMTok: number | null;
  outputPerMTok: number | null;
  cacheReadPerMTok: number | null;
  cacheWritePerMTok: number | null;
}

export interface CostLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

// Provider and model ids are namespaced so a model id that contains the
// separator can never collide with another provider's entry.
export function priceKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}

let prices: ReadonlyMap<string, ModelPrices> = new Map();

/** Replaces the price table (the catalog on a map, tests with a fixture). */
export function setModelPrices(entries: ReadonlyMap<string, ModelPrices>): void {
  prices = new Map(entries);
}

/** The price entry for a provider and model, or null when the catalog lacks it. */
export function modelPricesFor(provider: string, model: string): ModelPrices | null {
  return prices.get(priceKey(provider, model)) ?? null;
}

// One warning per unknown provider/model per process: a model the catalog does
// not know must not spam the log on every call.
const warned = new Set<string>();

/**
 * The USD cost of one call: uncached input × input price, output × output
 * price, cache reads × the cache-read price, cache writes × the cache-write
 * price. A model whose cache prices are missing falls back to its input price
 * (the provider charges uncached rate). An unknown model costs 0 and logs one
 * warning carrying the provider and model ids only.
 */
export function costOf(
  provider: string,
  model: string,
  usage: ChatUsage,
  logger?: CostLogger,
): number {
  const entry = modelPricesFor(provider, model);
  if (entry === null) {
    const key = priceKey(provider, model);
    if (!warned.has(key)) {
      warned.add(key);
      logger?.warn({ provider, model }, 'AI model has no catalog price; recording cost as 0');
    }
    return 0;
  }
  const inputPrice = entry.inputPerMTok ?? 0;
  const outputPrice = entry.outputPerMTok ?? 0;
  const cacheReadPrice = entry.cacheReadPerMTok ?? inputPrice;
  const cacheWritePrice = entry.cacheWritePerMTok ?? inputPrice;
  const micros =
    usage.inputTokens * inputPrice +
    usage.outputTokens * outputPrice +
    usage.cacheReadTokens * cacheReadPrice +
    usage.cacheWriteTokens * cacheWritePrice;
  return micros / 1_000_000;
}
