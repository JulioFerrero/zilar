import { describe, expect, it } from 'vitest';
import { buildUserModelEntry, modelNameForAi } from './model-entry';

describe('buildUserModelEntry', () => {
  it('builds the exact model_list entry for a user provider key', () => {
    expect(
      buildUserModelEntry({
        modelName: 'ai-abc123',
        providerModel: 'anthropic/claude-sonnet-4-5',
        apiKey: 'sk-user-owned-provider-key',
      }),
    ).toEqual({
      model_name: 'ai-abc123',
      litellm_params: {
        model: 'anthropic/claude-sonnet-4-5',
        api_key: 'sk-user-owned-provider-key',
      },
    });
  });

  it('adds an api_base for a custom endpoint', () => {
    expect(
      buildUserModelEntry({
        modelName: 'ai-ollama',
        providerModel: 'openai/llama3',
        apiKey: 'sk-user-owned-provider-key',
        apiBase: 'http://127.0.0.1:11434/v1',
      }),
    ).toEqual({
      model_name: 'ai-ollama',
      litellm_params: {
        model: 'openai/llama3',
        api_key: 'sk-user-owned-provider-key',
        api_base: 'http://127.0.0.1:11434/v1',
      },
    });
  });

  it('keeps the user key in its own group, with no platform reference', () => {
    const entry = buildUserModelEntry({
      modelName: 'ai-abc123',
      providerModel: 'openai/gpt-4o',
      apiKey: 'sk-user-owned-provider-key',
    });

    const serialized = JSON.stringify(entry);
    expect(serialized).toContain('sk-user-owned-provider-key');
    expect(serialized).not.toContain('os.environ');
    expect(entry.litellm_params.api_key).toBe('sk-user-owned-provider-key');
  });

  it('rejects invalid inputs', () => {
    const base = {
      modelName: 'ai-abc123',
      providerModel: 'openai/gpt-4o',
      apiKey: 'sk-user-owned-provider-key',
    };

    expect(() => buildUserModelEntry({ ...base, modelName: 'AI/../x' })).toThrow();
    expect(() => buildUserModelEntry({ ...base, providerModel: 'not-a-provider-model' })).toThrow();
    expect(() => buildUserModelEntry({ ...base, apiKey: '' })).toThrow();
    expect(() => buildUserModelEntry({ ...base, apiBase: 'not-a-url' })).toThrow();
  });
});

describe('modelNameForAi', () => {
  it('derives a stable group name from an AI id', () => {
    expect(modelNameForAi('abc-123')).toBe('ai-abc-123');
    expect(() => modelNameForAi('Bad/Id')).toThrow();
  });
});
