import { View } from 'react-native';

import { cn } from '@/lib/utils';

import { WIZARD_STEP_LABELS, wizardSegmentState, type WizardSegmentState } from './wizard-progress';

// The semantic colours are plain `var(--…)` without an alpha channel, so
// `bg-accent/40` renders nothing. Use element opacity for the done colour.
const SEGMENT_CLASS: Record<WizardSegmentState, string> = {
  done: 'bg-accent opacity-40',
  active: 'bg-accent',
  pending: 'bg-muted',
};

/** The wizard's compact step bar: six equal segments, filled up to `current`. */
export function WizardSteps({ current }: { current: number }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current} of ${WIZARD_STEP_LABELS.length}: ${WIZARD_STEP_LABELS[current - 1]}`}
      className="w-full flex-row items-center gap-1.5"
    >
      {WIZARD_STEP_LABELS.map((label, index) => (
        <View
          key={label}
          className={cn(
            'h-1.5 flex-1 rounded-full',
            SEGMENT_CLASS[wizardSegmentState(index + 1, current)],
          )}
        />
      ))}
    </View>
  );
}
