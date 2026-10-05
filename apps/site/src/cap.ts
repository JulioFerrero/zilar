// The monthly-cap dial: a knob that sweeps 270 degrees, from -135 (lowest cap) to +135 (highest).
export const CAP = { min: 5, max: 100, step: 5, initial: 20, sweep: 270 } as const;

const HALF_SWEEP = CAP.sweep / 2;

export function clampCap(value: number): number {
  const snapped = Math.round(value / CAP.step) * CAP.step;
  return Math.min(CAP.max, Math.max(CAP.min, snapped));
}

export function capToAngle(value: number): number {
  const ratio = (clampCap(value) - CAP.min) / (CAP.max - CAP.min);
  return -HALF_SWEEP + ratio * CAP.sweep;
}

export function angleToCap(angle: number): number {
  const clamped = Math.min(HALF_SWEEP, Math.max(-HALF_SWEEP, angle));
  return clampCap(CAP.min + ((clamped + HALF_SWEEP) / CAP.sweep) * (CAP.max - CAP.min));
}

// Angle of a pointer around the knob centre, in degrees: 0 points straight up, clockwise is positive.
export function pointerAngle(dx: number, dy: number): number {
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

export function stepCap(value: number, steps: number): number {
  return clampCap(value + steps * CAP.step);
}

export function capLabel(value: number): string {
  return `€${clampCap(value)}`;
}
