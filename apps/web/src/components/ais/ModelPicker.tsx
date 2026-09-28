import { providerLabel } from './ConnectionPicker';
import { SelectOption } from './AiPageShell';

/** The wizard's model picker: short per-provider hints, always overridable. */
export function ModelPicker({
  provider,
  suggestions,
  value,
  onChange,
  inputId = 'ai-model',
}: {
  provider: string;
  suggestions: readonly string[];
  value: string;
  onChange: (model: string) => void;
  inputId?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">Model</span>
        <input
          id={inputId}
          list="ai-model-suggestions"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`${providerLabel(provider)} model name`}
          maxLength={256}
          autoComplete="off"
          className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
        />
      </label>
      <datalist id="ai-model-suggestions">
        {suggestions.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>

      {suggestions.length > 0 && (
        <div role="radiogroup" aria-label="Model suggestion" className="flex flex-col gap-2">
          {suggestions.map((model) => (
            <SelectOption
              key={model}
              selected={value === model}
              onClick={() => onChange(model)}
              className="items-center py-2"
            >
              <span className="text-[15px]">{model}</span>
            </SelectOption>
          ))}
        </div>
      )}
    </div>
  );
}
