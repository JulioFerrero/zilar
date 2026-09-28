import type { KeyboardEvent } from 'react';
import { useRef } from 'react';
import { Check } from 'lucide-react';
import { providerLabel } from './ConnectionPicker';
import { cn } from '@/lib/utils';

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
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = suggestions.findIndex((model) => model === value);
  // With a custom value nothing is checked; the first option still takes the
  // tab stop so the radiogroup stays reachable from the keyboard.
  const tabbableIndex = selectedIndex === -1 ? 0 : selectedIndex;

  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = suggestions.length - 1;
    let next: number | undefined;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      next = index === last ? 0 : index + 1;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      next = index === 0 ? last : index - 1;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = last;
    }
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    const model = suggestions[next];
    if (model === undefined) {
      return;
    }
    onChange(model);
    optionRefs.current[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">Model</span>
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`${providerLabel(provider)} model name`}
          maxLength={256}
          autoComplete="off"
          className="well-surface rounded-lg px-3 py-2 text-[15px] outline-none"
        />
      </label>

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Suggested
          </span>
          <div role="radiogroup" aria-label="Model suggestion" className="flex flex-col gap-2">
            {suggestions.map((model, index) => {
              const selected = value === model;
              return (
                <button
                  key={model}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={index === tabbableIndex ? 0 : -1}
                  onClick={() => onChange(model)}
                  onKeyDown={(event) => moveSelection(event, index)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-lg border border-edge px-3 py-2 text-left text-[15px] transition-colors',
                    selected
                      ? 'segment-raised text-foreground'
                      : 'raised-pill text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="min-w-0 truncate">{model}</span>
                  {selected && <Check className="size-4 shrink-0" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
