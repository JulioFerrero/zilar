// The provider → Effect AI client map. The owner's key is decrypted per call,
// so the client (and the plaintext key) never lives in a global layer.
import * as Anthropic from '@effect/ai-anthropic';
import * as OpenAi from '@effect/ai-openai';
import * as OpenAiCompat from '@effect/ai-openai-compat';
import * as OpenRouter from '@effect/ai-openrouter';
import { Effect, Redacted } from 'effect';
import type { LanguageModel } from 'effect/ai';
import type { HttpClient } from 'effect/http';

// Provider ids an AI may name; an unknown value has no client, so the turn is
// skipped, not thrown.
export const MODEL_PROVIDERS = [
  'openai',
  'anthropic',
  'openrouter',
  'deepseek',
  'xai',
  'google',
  'openai-compatible',
] as const;

export type ModelProviderId = (typeof MODEL_PROVIDERS)[number];

const MODEL_PROVIDER_SET: ReadonlySet<string> = new Set(MODEL_PROVIDERS);

export function isModelProvider(value: string): value is ModelProviderId {
  return MODEL_PROVIDER_SET.has(value);
}

// One call's target: the provider, the model and the plaintext key decrypted
// for this call only. `apiUrl` overrides the official base URL.
export interface ModelTarget {
  provider: ModelProviderId;
  apiKey: string;
  model: string;
  apiUrl?: string;
  // A catalog provider runs as `openai-compatible` but is priced by this id.
  usageProvider?: string;
}

// These speak the OpenAI-compatible API; the package appends `/chat/completions`.
const COMPAT_BASE_URLS: Record<'deepseek' | 'xai' | 'google', string> = {
  deepseek: 'https://api.deepseek.com',
  xai: 'https://api.x.ai/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
};

// OpenAI's API and the compat package use `max_output_tokens`; Anthropic and
// OpenRouter use `max_tokens`.
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

// The key is `Redacted` and the client is provided per call, so two AIs with
// different keys never share one.
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
      // Without a base URL there is nothing to call: die rather than fetch a
      // default host.
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
