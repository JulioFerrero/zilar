import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  ADAPTER_DESCRIPTION_MAX_LENGTH,
  AdapterRegistryError,
  buildRegistry,
  type ActionAdapter,
} from './registry';

function makeAdapter(overrides: Partial<ActionAdapter<unknown>> = {}): ActionAdapter<unknown> {
  return {
    name: 'demo.echo',
    description: 'Echoes the input back.',
    tier: 0,
    argsSchema: z.object({ value: z.string() }),
    describe: () => ({ summary: 'echo' }),
    execute: async () => ({ summary: 'ok' }),
    ...overrides,
  };
}

describe('buildRegistry', () => {
  it('returns a registry keyed by adapter name', () => {
    const registry = buildRegistry([makeAdapter()]);
    expect(Object.keys(registry)).toEqual(['demo.echo']);
    expect(registry['demo.echo']?.tier).toBe(0);
  });

  it('rejects a duplicate name', () => {
    expect(() =>
      buildRegistry([makeAdapter({ name: 'demo.echo' }), makeAdapter({ name: 'demo.echo' })]),
    ).toThrow(AdapterRegistryError);
  });

  it('rejects a malformed name', () => {
    expect(() => buildRegistry([makeAdapter({ name: 'noDot' })])).toThrow(AdapterRegistryError);
    expect(() => buildRegistry([makeAdapter({ name: 'Demo.echo' })])).toThrow(AdapterRegistryError);
    expect(() => buildRegistry([makeAdapter({ name: '1demo.echo' })])).toThrow(
      AdapterRegistryError,
    );
    expect(() => buildRegistry([makeAdapter({ name: 'demo.' })])).toThrow(AdapterRegistryError);
    expect(() => buildRegistry([makeAdapter({ name: '.echo' })])).toThrow(AdapterRegistryError);
  });

  it('rejects an empty name', () => {
    expect(() => buildRegistry([makeAdapter({ name: '' })])).toThrow(AdapterRegistryError);
  });

  it('rejects an invalid tier', () => {
    expect(() => buildRegistry([makeAdapter({ tier: 3 as unknown as 0 })])).toThrow(
      AdapterRegistryError,
    );
  });

  it('rejects a missing describe or execute', () => {
    expect(() =>
      buildRegistry([
        makeAdapter({ describe: undefined as unknown as ActionAdapter<unknown>['describe'] }),
      ]),
    ).toThrow(AdapterRegistryError);
    expect(() =>
      buildRegistry([
        makeAdapter({ execute: undefined as unknown as ActionAdapter<unknown>['execute'] }),
      ]),
    ).toThrow(AdapterRegistryError);
  });

  it('rejects a missing or empty description', () => {
    expect(() =>
      buildRegistry([
        makeAdapter({ description: undefined as unknown as ActionAdapter<unknown>['description'] }),
      ]),
    ).toThrow(AdapterRegistryError);
    expect(() => buildRegistry([makeAdapter({ description: '' })])).toThrow(AdapterRegistryError);
    expect(() => buildRegistry([makeAdapter({ description: '   ' })])).toThrow(
      AdapterRegistryError,
    );
  });

  it('rejects an over-long description', () => {
    const tooLong = 'a'.repeat(ADAPTER_DESCRIPTION_MAX_LENGTH + 1);
    expect(() => buildRegistry([makeAdapter({ description: tooLong })])).toThrow(
      AdapterRegistryError,
    );
    // No off-by-one: exactly the cap is accepted.
    const atCap = 'a'.repeat(ADAPTER_DESCRIPTION_MAX_LENGTH);
    expect(() => buildRegistry([makeAdapter({ description: atCap })])).not.toThrow();
  });

  it('accepts an empty list', () => {
    expect(buildRegistry([])).toEqual({});
  });

  it('accepts tier 0, 1 and 2', () => {
    for (const tier of [0, 1, 2] as const) {
      const registry = buildRegistry([makeAdapter({ name: `tier${tier}.demo`, tier })]);
      expect(registry[`tier${tier}.demo`]?.tier).toBe(tier);
    }
  });
});
