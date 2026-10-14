import { useState } from 'react';
import { Select, type SelectOption } from './select';

const PROVIDERS: readonly SelectOption[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'xai', label: 'xAI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'github', label: 'GitHub' },
];

const MANY: readonly SelectOption[] = [
  ...PROVIDERS,
  { value: 'mistral', label: 'Mistral' },
  { value: 'groq', label: 'Groq' },
  { value: 'together', label: 'Together AI' },
  { value: 'fireworks', label: 'Fireworks AI' },
  { value: 'perplexity', label: 'Perplexity' },
];

function OpenSelect() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <div className="w-72">
      <Select
        options={PROVIDERS}
        value={value}
        onValueChange={setValue}
        label="Provider"
        placeholder="Choose a provider"
      />
    </div>
  );
}

function FilterableSelect() {
  const [value, setValue] = useState<string | null>('openai');
  return (
    <div className="w-72">
      <Select options={MANY} value={value} onValueChange={setValue} label="Provider" />
    </div>
  );
}

export default {
  Default: <OpenSelect />,
  Filterable: <FilterableSelect />,
};
