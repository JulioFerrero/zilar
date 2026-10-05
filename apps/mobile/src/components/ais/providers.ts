const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  openrouter: 'OpenRouter',
  github: 'GitHub',
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}
