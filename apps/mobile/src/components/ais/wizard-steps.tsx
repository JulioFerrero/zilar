import { View } from 'react-native';

import { cn } from '@/lib/utils';

const STEP_LABELS = ['Name & template', 'Persona', 'Provider', 'Model', 'Limits', 'Review'];

/** The wizard's compact step dots, with the current one in accent. */
export function WizardSteps({ current }: { current: number }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current} of ${STEP_LABELS.length}: ${STEP_LABELS[current - 1]}`}
      className="flex-row items-center gap-1.5"
    >
      {STEP_LABELS.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;
        return (
          <View
            key={label}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              active ? 'bg-accent' : done ? 'bg-accent/40' : 'bg-muted',
            )}
          />
        );
      })}
    </View>
  );
}
