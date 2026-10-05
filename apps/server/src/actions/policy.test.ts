import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import type { ActionAdapter } from './registry';
import { policy } from './policy';

const echoSchema = z.object({ value: z.string() });
const strictSchema = z.object({ required: z.number().int().nonnegative() });

function adapter(tier: 0 | 1 | 2, schema: z.ZodTypeAny = echoSchema): ActionAdapter<unknown> {
  return {
    name: 'demo.echo',
    description: 'Echo adapter.',
    tier,
    argsSchema: schema,
    describe: () => ({ summary: 'echo' }),
    execute: async () => ({ summary: 'ok' }),
  };
}

describe('policy', () => {
  it('denies an unknown action', () => {
    const verdict = policy({
      adapter: null,
      rawArgs: { value: 'x' },
      aiStatus: 'active',
      aiInGroup: null,
    });
    expect(verdict).toEqual({ kind: 'deny', reason: 'unknown_action' });
  });

  it('denies when the AI is not active (stopped)', () => {
    const verdict = policy({
      adapter: adapter(0),
      rawArgs: { value: 'x' },
      aiStatus: 'stopped',
      aiInGroup: null,
    });
    expect(verdict).toEqual({ kind: 'deny', reason: 'ai_not_active' });
  });

  it('denies when the AI is not active (provisioning / disabled)', () => {
    const verdict = policy({
      adapter: adapter(0),
      rawArgs: { value: 'x' },
      aiStatus: 'disabled',
      aiInGroup: null,
    });
    expect(verdict).toEqual({ kind: 'deny', reason: 'ai_not_active' });
  });

  it('denies when the AI is missing (null status)', () => {
    const verdict = policy({
      adapter: adapter(0),
      rawArgs: { value: 'x' },
      aiStatus: null,
      aiInGroup: null,
    });
    expect(verdict).toEqual({ kind: 'deny', reason: 'ai_not_active' });
  });

  it('denies when the AI is not in the named group', () => {
    const verdict = policy({
      adapter: adapter(0),
      rawArgs: { value: 'x' },
      aiStatus: 'active',
      aiInGroup: false,
    });
    expect(verdict).toEqual({ kind: 'deny', reason: 'ai_not_in_group' });
  });

  it('allows when the AI is in the named group', () => {
    const verdict = policy({
      adapter: adapter(0),
      rawArgs: { value: 'x' },
      aiStatus: 'active',
      aiInGroup: true,
    });
    expect(verdict).toEqual({ kind: 'allow', tier: 0 });
  });

  it('denies when args fail the adapter schema', () => {
    const verdict = policy({
      adapter: adapter(0, strictSchema),
      rawArgs: { required: -1 },
      aiStatus: 'active',
      aiInGroup: null,
    });
    expect(verdict).toEqual({ kind: 'deny', reason: 'invalid_args' });
  });

  it('allows tier 0 with valid args', () => {
    const verdict = policy({
      adapter: adapter(0),
      rawArgs: { value: 'x' },
      aiStatus: 'active',
      aiInGroup: null,
    });
    expect(verdict).toEqual({ kind: 'allow', tier: 0 });
  });

  it('allows tier 1 with valid args', () => {
    const verdict = policy({
      adapter: adapter(1),
      rawArgs: { value: 'x' },
      aiStatus: 'active',
      aiInGroup: null,
    });
    expect(verdict).toEqual({ kind: 'allow', tier: 1 });
  });

  it('requires approval on tier 2 with valid args', () => {
    const verdict = policy({
      adapter: adapter(2),
      rawArgs: { value: 'x' },
      aiStatus: 'active',
      aiInGroup: null,
    });
    expect(verdict).toEqual({ kind: 'require_approval', tier: 2 });
  });

  it('runs AI checks before the args check', () => {
    // An unknown action beats invalid_args: the gateway returns the first
    // reason that trips, and `unknown_action` is checked before args.
    const verdict = policy({
      adapter: null,
      rawArgs: 'definitely not an object',
      aiStatus: 'active',
      aiInGroup: null,
    });
    expect(verdict).toEqual({ kind: 'deny', reason: 'unknown_action' });
  });
});
