import { useState } from 'react';
import { Combobox, type ComboboxOption } from './combobox';

const PROVIDERS: ComboboxOption[] = [
  { value: 'openai', label: 'OpenAI', dot: 'online' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'amazon-bedrock', label: 'Amazon Bedrock' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'google', label: 'Google' },
  { value: 'groq', label: 'Groq' },
  { value: 'mistral', label: 'Mistral' },
];

const MANY: ComboboxOption[] = Array.from({ length: 250 }, (_, index) => ({
  value: `model-${index}`,
  label: `Model ${String(index + 1).padStart(3, '0')}`,
}));

function ProviderCombobox() {
  const [value, setValue] = useState<string | null>('deepseek');
  return (
    <div className="w-80">
      <Combobox
        options={PROVIDERS}
        value={value}
        onValueChange={setValue}
        label="Provider"
        placeholder="Search 229 providers"
        triggerPlaceholder="Choose a provider"
        footerItem={{ label: 'OpenAI-compatible', onSelect: () => {} }}
      />
    </div>
  );
}

function LargeListCombobox() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <div className="w-80">
      <Combobox
        options={MANY}
        value={value}
        onValueChange={setValue}
        label="Model"
        placeholder="Search 250 models"
        triggerPlaceholder="Choose a model"
      />
    </div>
  );
}

function OnlineCombobox() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <div className="w-80">
      <Combobox
        options={PROVIDERS}
        value={value}
        onValueChange={setValue}
        label="Provider"
        placeholder="Search providers"
        triggerPlaceholder="Choose a provider"
      />
    </div>
  );
}

export default {
  Default: <ProviderCombobox />,
  ManyItems: <LargeListCombobox />,
  NoSelection: <OnlineCombobox />,
};
