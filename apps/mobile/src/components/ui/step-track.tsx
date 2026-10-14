import { Check } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { segment, well } from '@/lib/depth';
import { cn } from '@/lib/utils';

export interface StepTrackStep {
  value: string;
  label: string;
  /** Marks a step the flow has already passed; defaults to the steps before `current`. */
  done?: boolean;
}

export interface StepTrackProps {
  steps: readonly StepTrackStep[];
  /** The value of the step being shown now. */
  current: string;
  /** Tapping a done step jumps back to it, when given. */
  onStepPress?: (value: string) => void;
  /** Beats the built-in "Step N of M: <label>" announcement. */
  accessibilityLabel?: string;
}

/**
 * The New AI flow's step bar (approved 2026-10-15, `PhoneKey.dc.html`): a well
 * track of 34 px segments. The current step is the raised segment; a done step
 * shows a check and its value in the muted colour, and is pressable; later
 * steps are subtle and inert. The current segment carries the selected state in
 * its `key` so the raised style re-applies when the step changes.
 */
export function StepTrack({ steps, current, onStepPress, accessibilityLabel }: StepTrackProps) {
  const currentIndex = steps.findIndex((step) => step.value === current);
  const currentStep = steps[currentIndex];
  const trackLabel =
    accessibilityLabel ??
    (currentStep !== undefined
      ? `Step ${currentIndex + 1} of ${steps.length}: ${currentStep.label}`
      : undefined);

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={trackLabel}
      className="flex-row gap-0.5 rounded-[10px] p-[3px]"
      style={[well, { borderColor: '#1a1a1a' }]}
    >
      {steps.map((step, index) => {
        const active = index === currentIndex;
        const done = !active && (step.done ?? index < currentIndex);
        const canPress = done && onStepPress !== undefined;
        const labelTone = active
          ? 'text-foreground'
          : done
            ? 'text-muted-foreground'
            : 'text-subtle-foreground';
        return (
          <Pressable
            key={`${step.value}-${active ? 'on' : done ? 'done' : 'off'}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: !canPress }}
            accessibilityLabel={step.label}
            disabled={!canPress}
            onPress={() => onStepPress?.(step.value)}
            className={cn(
              'h-[34px] flex-1 flex-row items-center justify-center rounded-[7px]',
              done && 'gap-1',
            )}
            style={active ? segment : undefined}
          >
            {done ? <Check size={11} strokeWidth={2.8} color={MUTED_FOREGROUND} /> : null}
            <Text className={cn('text-[12px] font-medium', labelTone)}>{step.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
