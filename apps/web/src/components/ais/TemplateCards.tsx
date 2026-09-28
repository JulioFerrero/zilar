import type { AiTemplate } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AI_TEMPLATE_OPTIONS } from './templates';

/** The four template cards of wizard step 1. */
export function TemplateCards({
  value,
  onChange,
}: {
  value: AiTemplate;
  onChange: (template: AiTemplate) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Template" className="grid gap-2 sm:grid-cols-2">
      {AI_TEMPLATE_OPTIONS.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              'flex flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition-colors',
              selected
                ? 'border-accent bg-accent/10'
                : 'border-divider hover:border-muted-foreground/40 hover:bg-list-hover',
            )}
          >
            <span className="text-[16px] font-semibold">{option.label}</span>
            <span className="text-[13px] text-muted-foreground">{option.description}</span>
          </button>
        );
      })}
    </div>
  );
}
