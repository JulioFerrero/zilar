import { describe, expect, it } from 'vitest';
import {
  FLAP_WIDTH,
  MAX_VERSIONS,
  PROVIDERS,
  TOOL_VERSIONS,
  angleToProvider,
  changedLines,
  countdown,
  flapText,
  groupHex,
  hexId,
  isScheduleId,
  providerAngle,
  revertTo,
  settle,
} from './demo';

const fixed = (value: number) => () => value;

describe('flapText', () => {
  it('pads to the row width and uppercases', () => {
    expect(flapText('daily 09:00')).toBe('DAILY 09:00  ');
    expect(flapText('daily 09:00')).toHaveLength(FLAP_WIDTH);
  });

  it('cuts text longer than the row', () => {
    expect(flapText('abcdefghijklmnopq', 5)).toBe('ABCDE');
  });
});

describe('countdown', () => {
  it('formats minutes and seconds and never goes negative', () => {
    expect(countdown(3599)).toBe('59:59');
    expect(countdown(61.9)).toBe('01:01');
    expect(countdown(-4)).toBe('00:00');
  });
});

describe('fingerprints', () => {
  it('builds hex ids and groups them in fours', () => {
    expect(hexId(fixed(0.99), 3)).toBe('fff');
    expect(groupHex('a1b2c3d4e5f6')).toBe('a1b2 c3d4 e5f6');
  });

  it('settles from the left and keeps the spaces', () => {
    expect(settle('a1b2 c3d4', 2, fixed(0))).toBe('a100 0000');
    expect(settle('a1b2 c3d4', 9, fixed(0))).toBe('a1b2 c3d4');
  });
});

describe('versions', () => {
  it('reverts by appending a copy, never by rewriting', () => {
    const next = revertTo(TOOL_VERSIONS, 1);
    expect(next).toHaveLength(TOOL_VERSIONS.length + 1);
    expect(next.at(-1)).toEqual({ n: 4, title: 'Revert to v1', code: TOOL_VERSIONS[0]?.code });
    expect(next.slice(0, 3)).toEqual(TOOL_VERSIONS);
  });

  it('ignores the latest version, unknown versions and a full history', () => {
    expect(revertTo(TOOL_VERSIONS, 3)).toBe(TOOL_VERSIONS);
    expect(revertTo(TOOL_VERSIONS, 9)).toBe(TOOL_VERSIONS);
    let full = TOOL_VERSIONS;
    while (full.length < MAX_VERSIONS) full = revertTo(full, 1);
    expect(revertTo(full, 1)).toBe(full);
  });

  it('marks the lines that changed since the previous version', () => {
    expect(changedLines(undefined, ['a'])).toEqual([false]);
    expect(changedLines(['a', 'b'], ['a', 'c'])).toEqual([false, true]);
  });
});

describe('provider selector', () => {
  it('maps detents to angles and back', () => {
    expect(providerAngle(0)).toBe(-75);
    expect(providerAngle(PROVIDERS.length - 1)).toBe(75);
    PROVIDERS.forEach((_, index) => expect(angleToProvider(providerAngle(index))).toBe(index));
  });

  it('clamps angles past either end', () => {
    expect(angleToProvider(-170)).toBe(0);
    expect(angleToProvider(170)).toBe(PROVIDERS.length - 1);
  });
});

describe('isScheduleId', () => {
  it('accepts only known schedules', () => {
    expect(isScheduleId('daily')).toBe(true);
    expect(isScheduleId('yearly')).toBe(false);
    expect(isScheduleId(undefined)).toBe(false);
  });
});
