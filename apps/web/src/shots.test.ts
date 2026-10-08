import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import { parseShots, SHOT_SETUPS, shotTable } from '../../../scripts/shots';

describe('screenshot shot table (T-0133)', () => {
  it('parses the committed shot table', () => {
    expect(shotTable(Schema).length).toBe(17);
  });

  it('rejects a typo in a setup name before the browser starts', () => {
    // Fix 9: `setup` is a literal-union schema, so a typo fails in validation
    // (run before the browser starts) instead of mid-run in `runSetup`. With a
    // plain string schema this parse would succeed.
    const [first, ...rest] = shotTable(Schema);
    if (first === undefined) {
      throw new Error('expected at least one shot');
    }
    const typo = { ...first, setup: 'searchTicktes' };
    expect(() => parseShots(Schema, [typo, ...rest])).toThrow();
  });

  it('covers exactly the setups the runner implements', () => {
    expect(new Set(shotTable(Schema).map((shot) => shot.setup))).toEqual(new Set(SHOT_SETUPS));
  });
});
