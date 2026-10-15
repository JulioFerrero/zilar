import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DialogStep {
  label: string;
  /** A short value shown on a done step ("DeepSeek", "Key"). Falls back to `label`. */
  value?: string;
}

export interface DialogStepperProps {
  steps: DialogStep[];
  /** Zero-based index of the current step. */
  current: number;
  /** Called with a done step's index when it is pressed. */
  onStep?: (index: number) => void;
}

const SEGMENT = 'flex h-7 items-center justify-center rounded-[7px] text-[13px] font-medium';

/**
 * The New AI step bar: a segmented well whose done steps show a check and their
 * value, the current step is the dark raised segment, and later steps are muted
 * (`docs/design/mockups/new-ai`).
 */
export function DialogStepper({ steps, current, onStep }: DialogStepperProps) {
  const currentStep = steps[current];
  return (
    <div
      role="group"
      aria-label={
        currentStep === undefined
          ? 'Steps'
          : `Step ${current + 1} of ${steps.length}: ${currentStep.label}`
      }
      className="well-surface grid gap-0.5 rounded-[10px] p-[3px]"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((step, index) => {
        if (index < current) {
          return (
            <button
              key={step.label}
              type="button"
              onClick={() => onStep?.(index)}
              className={cn(SEGMENT, 'gap-1.5 text-muted-foreground hover:text-foreground')}
            >
              <Check className="size-3" strokeWidth={2.6} aria-hidden="true" />
              {step.value ?? step.label}
            </button>
          );
        }
        return (
          <span
            key={step.label}
            aria-current={index === current ? 'step' : undefined}
            className={cn(
              SEGMENT,
              index === current ? 'segment-raised text-foreground' : 'text-subtle-foreground',
            )}
          >
            {step.label}
          </span>
        );
      })}
    </div>
  );
}
