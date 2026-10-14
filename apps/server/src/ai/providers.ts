// The provider → Effect AI client map (docs/audit/effect-ai-plan.md §4). We
// hold one key per AI — the owner's provider key, decrypted per call — so the
// client (and the plaintext key) is built per call and never lives in a global
// layer. `effect/ai` normalises our `Prompt`/`Toolkit` into each provider's
// wire format, so nothing here builds a request body by hand.
import * as Anthropic from '@effect/ai-anthropic';
import * as OpenAi from '@effect/ai-openai';
import * as OpenAiCompat from '@effect/ai-openai-compat';
import * as OpenRouter from '@effect/ai-openrouter';
import { Effect, Redacted } from 'effect';
import type { LanguageModel } from 'effect/ai';
import type { HttpClient } from 'effect/http';

// The provider ids an AI's connection may name. Everything else (`github`, and
// any unknown value) has no model client: the turn is skipped, not thrown.
export const MODEL_PROVIDERS = [
  'openai',
  'anthropic',
  'openrouter',
  'deepseek',
  'xai',
  'google',
  // T-1396: the user's own OpenAI-compatible endpoint (custom base URL).
  'openai-compatible',
] as const;

export type ModelProviderId = (typeof MODEL_PROVIDERS)[number];

const MODEL_PROVIDER_SET: ReadonlySet<string> = new Set(MODEL_PROVIDERS);

export function isModelProvider(value: string): value is ModelProviderId {
  return MODEL_PROVIDER_SET.has(value);
}

// One model call's target: the provider, the model and the plaintext key
// decrypted for this call only. `apiUrl` overrides the provider's official
// base URL — a local fake server in tests, and T-1396's custom provider later.
export interface ModelTarget {
  provider: ModelProviderId;
  apiKey: string;
  model: string;
  apiUrl?: string;
  // T-1429: a catalog provider runs as `openai-compatible` but its usage and
  // prices are keyed by the catalog id, so the turn records that id.
  usageProvider?: string;
}

// The remaining providers speak the OpenAI-compatible chat-completions API;
// the compat package appends `/chat/completions` to these base URLs.
const COMPAT_BASE_URLS: Record<'deepseek' | 'xai' | 'google', string> = {
  deepseek: 'https://api.deepseek.com',
  xai: 'https://api.x.ai/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
};

// The provider's own field name for the output-token cap. OpenAI's responses
// API and the compat package use `max_output_tokens`; Anthropic and OpenRouter
// use `max_tokens`.
function tokenConfig(provider: ModelProviderId, maxTokens: number | undefined) {
  if (maxTokens === undefined) {
    return {};
  }
  return provider === 'openai' ||
    provider === 'deepseek' ||
    provider === 'xai' ||
    provider === 'google' ||
    provider === 'openai-compatible'
    ? { max_output_tokens: maxTokens }
    : { max_tokens: maxTokens };
}

// Builds the language model for one call. The key is a `Redacted` value that
// goes out of scope when the effect finishes; the client service is provided
// per call, so two AIs with different keys never share a client.
export function buildLanguageModel(
  target: ModelTarget,
  maxTokens?: number,
): Effect.Effect<LanguageModel.LanguageModel, never, HttpClient.HttpClient> {
  const apiKey = Redacted.make(target.apiKey);
  const apiUrl = target.apiUrl;
  const provider = target.provider;
  const config = tokenConfig(provider, maxTokens);

  switch (provider) {
    case 'openai':
      return Effect.gen(function* () {
        const client = yield* OpenAi.OpenAiClient.make({
          apiKey,
          ...(apiUrl === undefined ? {} : { apiUrl }),
        });
        return yield* OpenAi.OpenAiLanguageModel.make({ model: target.model, config }).pipe(
          Effect.provideService(OpenAi.OpenAiClient.OpenAiClient, client),
        );
      });
    case 'anthropic':
      return Effect.gen(function* () {
        const client = yield* Anthropic.AnthropicClient.make({
          apiKey,
          ...(apiUrl === undefined ? {} : { apiUrl }),
        });
        return yield* Anthropic.AnthropicLanguageModel.make({ model: target.model, config }).pipe(
          Effect.provideService(Anthropic.AnthropicClient.AnthropicClient, client),
        );
      });
    case 'openrouter':
      return Effect.gen(function* () {
        const client = yield* OpenRouter.OpenRouterClient.make({
          apiKey,
          ...(apiUrl === undefined ? {} : { apiUrl }),
        });
        return yield* OpenRouter.OpenRouterLanguageModel.make({ model: target.model, config }).pipe(
          Effect.provideService(OpenRouter.OpenRouterClient.OpenRouterClient, client),
        );
      });
    case 'deepseek':
    case 'xai':
    case 'google':
      return Effect.gen(function* () {
        const client = yield* OpenAiCompat.OpenAiClient.make({
          apiKey,
          apiUrl: apiUrl ?? COMPAT_BASE_URLS[provider],
        });
        return yield* OpenAiCompat.OpenAiLanguageModel.make({
          model: target.model,
          config,
        }).pipe(Effect.provideService(OpenAiCompat.OpenAiClient.OpenAiClient, client));
      });
    case 'openai-compatible':
      // T-1396: the user's own base URL. `loadModelTarget` always sets it;
      // without one there is nothing to call, so the turn dies (never a bare
      // fetch to a default host).
      return Effect.gen(function* () {
        if (apiUrl === undefined) {
          return yield* Effect.die(new Error('openai-compatible requires a base URL'));
        }
        const client = yield* OpenAiCompat.OpenAiClient.make({ apiKey, apiUrl });
        return yield* OpenAiCompat.OpenAiLanguageModel.make({
          model: target.model,
          config,
        }).pipe(Effect.provideService(OpenAiCompat.OpenAiClient.OpenAiClient, client));
      });
    default:
      return Effect.die(new Error(`unsupported model provider: ${provider}`));
  }
}
