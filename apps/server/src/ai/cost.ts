// What one model call costs, in USD, from the models.dev prices the catalog
// keeps. Prices are USD per million tokens.
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

// Namespaced so a model id containing the separator cannot collide with
// another provider's entry.
export function priceKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}

let prices: ReadonlyMap<string, ModelPrices> = new Map();

export function setModelPrices(entries: ReadonlyMap<string, ModelPrices>): void {
  prices = new Map(entries);
}

export function modelPricesFor(provider: string, model: string): ModelPrices | null {
  return prices.get(priceKey(provider, model)) ?? null;
}

// One warning per unknown model per process, so a call does not spam the log.
const warned = new Set<string>();

/**
 * Cache prices fall back to the input price (what the provider charges
 * uncached); an unknown model costs 0 and logs one warning with ids only.
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
