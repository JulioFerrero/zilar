import { describe, expect, it } from 'vitest';
import { isLlmProvider, litellmModelFor } from './litellm-model';

describe('litellmModelFor', () => {
  const cases: Array<[string, string, string]> = [
    ['openai', 'gpt-4o-mini', 'openai/gpt-4o-mini'],
    ['anthropic', 'claude-sonnet-4-5', 'anthropic/claude-sonnet-4-5'],
    ['google', 'gemini-2.5-flash', 'gemini/gemini-2.5-flash'],
    ['deepseek', 'deepseek-chat', 'deepseek/deepseek-chat'],
    ['xai', 'grok-4', 'xai/grok-4'],
    ['openrouter', 'meta-llama/llama-3.1-70b', 'openrouter/meta-llama/llama-3.1-70b'],
  ];

  for (const [provider, model, expected] of cases) {
    it(`maps ${provider} to ${expected}`, () => {
      expect(litellmModelFor(provider, model)).toBe(expected);
    });
  }

  it('rejects a provider that is not an LLM provider', () => {
    expect(() => litellmModelFor('github', 'gpt-4o')).toThrow(/not an LLM provider/);
    expect(() => litellmModelFor('unknown', 'gpt-4o')).toThrow(/not an LLM provider/);
  });
});

describe('isLlmProvider', () => {
  it('accepts every LLM provider and rejects github and unknown ids', () => {
    for (const provider of ['openai', 'anthropic', 'google', 'deepseek', 'xai', 'openrouter']) {
      expect(isLlmProvider(provider)).toBe(true);
    }
    expect(isLlmProvider('github')).toBe(false);
    expect(isLlmProvider('unknown')).toBe(false);
  });
});
