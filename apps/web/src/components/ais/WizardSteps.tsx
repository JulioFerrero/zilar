import { cn } from '@/lib/utils';

const STEP_LABELS = ['Name & template', 'Persona', 'Provider', 'Model', 'Limits', 'Review'];

/** The wizard's step indicator: a number per step, accent for the current one. */
export function WizardSteps({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Wizard steps">
      {STEP_LABELS.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li
            key={label}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px]',
              active ? 'bg-accent/10 font-medium text-accent' : 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-[11px] font-semibold',
                active
                  ? 'bg-accent text-accent-foreground'
                  : done
                    ? 'bg-accent/20 text-accent'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {done ? '✓' : step}
            </span>
            <span className="hidden whitespace-nowrap sm:inline">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
