import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import { parseShots, SHOT_SETUPS, shotTable, type ZodLib } from '../../../scripts/shots';

/**
 * `scripts/shots.ts` injects a zod-like lib so it stays import-free; this
 * adapter backs it with Effect Schema, which keeps zod out of `apps/web`.
 * `.parse` maps to `Schema.decodeUnknownSync` on a mutable array.
 */
interface LibSchema {
  readonly effect: Schema.ConstraintDecoder<unknown>;
  array(): { parse(value: unknown): unknown };
}

function libSchema(effect: Schema.ConstraintDecoder<unknown>): LibSchema {
  return {
    effect,
    array: () => ({
      parse: (value) => Schema.decodeUnknownSync(Schema.mutable(Schema.Array(effect)))(value),
    }),
  };
}

const effectLib: ZodLib = {
  string: () => libSchema(Schema.String),
  number: () => libSchema(Schema.Number),
  enum: (values) => libSchema(Schema.Literals(values)),
  object: (shape) =>
    libSchema(
      Schema.Struct(
        Object.fromEntries(
          Object.entries(shape).map(([key, field]) => [key, (field as LibSchema).effect]),
        ),
      ),
    ),
};

describe('screenshot shot table (T-0133)', () => {
  it('parses the committed shot table', () => {
    expect(shotTable(effectLib).length).toBe(17);
  });

  it('rejects a typo in a setup name before the browser starts', () => {
    // Fix 9: `setup` is a literal-union schema, so a typo fails in validation
    // (run before the browser starts) instead of mid-run in `runSetup`. With a
    // plain string schema this parse would succeed.
    const [first, ...rest] = shotTable(effectLib);
    if (first === undefined) {
      throw new Error('expected at least one shot');
    }
    const typo = { ...first, setup: 'searchTicktes' };
    expect(() => parseShots(effectLib, [typo, ...rest])).toThrow();
  });

  it('covers exactly the setups the runner implements', () => {
    expect(new Set(shotTable(effectLib).map((shot) => shot.setup))).toEqual(new Set(SHOT_SETUPS));
  });
});
