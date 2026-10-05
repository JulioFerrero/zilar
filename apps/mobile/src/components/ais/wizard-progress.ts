export const WIZARD_STEP_LABELS = [
  'Name & template',
  'Persona',
  'Provider',
  'Model',
  'Limits',
  'Review',
] as const;

export type WizardSegmentState = 'done' | 'active' | 'pending';

/** Visual state of the segment for `step` when `current` is the open step. */
export function wizardSegmentState(step: number, current: number): WizardSegmentState {
  if (step < current) {
    return 'done';
  }
  if (step === current) {
    return 'active';
  }
  return 'pending';
}
