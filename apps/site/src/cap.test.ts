import { describe, expect, it } from 'vitest';

import { CAP, angleToCap, capLabel, capToAngle, clampCap, pointerAngle, stepCap } from './cap';

describe('the monthly cap dial', () => {
  it('snaps to the step and stays inside the range', () => {
    expect(clampCap(22)).toBe(20);
    expect(clampCap(23)).toBe(25);
    expect(clampCap(-40)).toBe(CAP.min);
    expect(clampCap(400)).toBe(CAP.max);
  });

  it('maps the range onto the 270 degree sweep', () => {
    expect(capToAngle(CAP.min)).toBe(-135);
    expect(capToAngle(CAP.max)).toBe(135);
    expect(angleToCap(-135)).toBe(CAP.min);
    expect(angleToCap(135)).toBe(CAP.max);
  });

  it('round-trips every step', () => {
    for (let value = CAP.min; value <= CAP.max; value += CAP.step) {
      expect(angleToCap(capToAngle(value))).toBe(value);
    }
  });

  it('holds at the ends when the pointer goes past the sweep', () => {
    expect(angleToCap(170)).toBe(CAP.max);
    expect(angleToCap(-170)).toBe(CAP.min);
  });

  it('reads the pointer angle clockwise from the top', () => {
    expect(pointerAngle(0, -1)).toBeCloseTo(0);
    expect(pointerAngle(1, 0)).toBeCloseTo(90);
    expect(pointerAngle(-1, 0)).toBeCloseTo(-90);
  });

  it('steps with the keyboard and labels in euros', () => {
    expect(stepCap(20, 1)).toBe(25);
    expect(stepCap(CAP.max, 3)).toBe(CAP.max);
    expect(capLabel(35)).toBe('€35');
  });
});
