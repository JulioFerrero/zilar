import { describe, expect, it } from 'vitest';
import { defaultModelFor, modelSuggestionsFor } from './ai-models';

const PROVIDERS = ['openai', 'anthropic', 'google', 'deepseek', 'xai', 'openrouter'] as const;

describe('defaultModelFor', () => {
  it('returns the first suggestion for every provider', () => {
    expect(defaultModelFor('openai')).toBe('gpt-4o');
    expect(defaultModelFor('anthropic')).toBe('claude-opus-5-5');
    expect(defaultModelFor('google')).toBe('gemini-2.5-pro');
    expect(defaultModelFor('deepseek')).toBe('deepseek-chat');
    expect(defaultModelFor('xai')).toBe('grok-4');
    expect(defaultModelFor('openrouter')).toBe('openai/gpt-4o');
  });

  it('is always the first of the provider suggestions', () => {
    for (const provider of PROVIDERS) {
      expect(defaultModelFor(provider)).toBe(modelSuggestionsFor(provider)[0]);
    }
  });

  it('returns an empty string for an unknown provider', () => {
    expect(defaultModelFor('unknown-provider')).toBe('');
  });
});
