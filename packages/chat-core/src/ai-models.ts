// A short, static hint list per provider. The model input is always editable
// and, when the server's models.dev catalog (T-1395) cannot be reached, these
// hints are the picker's fallback.
const MODEL_SUGGESTIONS: Record<string, readonly string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  xai: ['grok-4', 'grok-3', 'grok-3-mini'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro'],
};

export function modelSuggestionsFor(provider: string): readonly string[] {
  return MODEL_SUGGESTIONS[provider] ?? [];
}

/** The first suggestion for a provider, used to prefill the model field. */
export function defaultModelFor(provider: string): string {
  return modelSuggestionsFor(provider)[0] ?? '';
}

/**
 * The catalog model fields the pickers render (T-1395). The server's
 * `AiCatalogModel` is assignable to this, so a picker takes the wire type
 * without `chat-core` depending on `@zilar/api-contract`.
 */
export interface CatalogModelView {
  readonly id: string;
  readonly name: string;
  readonly contextTokens: number;
  readonly inputPricePerMTok: number | null;
  readonly outputPricePerMTok: number | null;
  readonly toolCalls: boolean;
}

/** The model to preselect: the first that can call tools, else the first one. */
export function defaultCatalogModelId(models: readonly CatalogModelView[]): string {
  return (models.find((model) => model.toolCalls) ?? models[0])?.id ?? '';
}

/** "200K", "1M", "8192"; `0` means the catalog did not know the size. */
export function formatContextTokens(tokens: number): string {
  if (tokens <= 0) {
    return '—';
  }
  if (tokens >= 1_000_000) {
    return `${trimNumber(tokens / 1_000_000)}M`;
  }
  if (tokens >= 1_000) {
    return `${trimNumber(tokens / 1_000)}K`;
  }
  return String(tokens);
}

/** "$3 / $15 per M tokens", or "Price unavailable" when a side is unknown. */
export function formatModelPrices(input: number | null, output: number | null): string {
  if (input === null || output === null) {
    return 'Price unavailable';
  }
  return `$${formatUsd(input)} / $${formatUsd(output)} per M tokens`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

// Prices are USD per million tokens; keep small ones readable without
// printing float noise.
function formatUsd(value: number): string {
  if (value === 0) {
    return '0';
  }
  if (value >= 0.0001) {
    return String(Number(value.toFixed(4)));
  }
  return value.toExponential(1);
}
