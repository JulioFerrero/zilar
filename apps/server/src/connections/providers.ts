import { Schema } from 'effect';

// The fixed list of providers matched from the plan §20.3 (OpenAI, Anthropic,
// Google Gemini, DeepSeek, xAI, OpenRouter) plus GitHub (needed for git
// integration). The ids here are the stable machine-readable names; the UI
// layer can choose whatever display label it wants.
export const PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'openrouter',
  'github',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const ProviderIdSchema = Schema.Literals(PROVIDER_IDS);
