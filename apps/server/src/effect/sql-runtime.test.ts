// T-0510: the `effect/sql` runtime registry is wired by `createApp` and torn
// down by `disposeSqlRuntime`. These tests exercise the registry directly,
// without a route, so a regression in the wiring fails here rather than as a
// thrown "No effect/sql runtime registered" deep inside a module test.

import { describe, expect, it } from 'vitest';
import { createTestContext, testApp } from '../test-support';
import { disposeSqlRuntime, sqlRuntimeFor } from './sql';

describe('effect/sql runtime registry', () => {
  it('is registered by createApp for the app database', async () => {
    const context = await createTestContext();
    try {
      testApp(context);
      expect(() => sqlRuntimeFor(context.db)).not.toThrow();
    } finally {
      await disposeSqlRuntime(context.db);
      await context.close();
    }
  });

  it('dispose is idempotent and forgets the runtime', async () => {
    const context = await createTestContext();
    testApp(context);
    try {
      await expect(disposeSqlRuntime(context.db)).resolves.toBeUndefined();
      await expect(disposeSqlRuntime(context.db)).resolves.toBeUndefined();
      expect(() => sqlRuntimeFor(context.db)).toThrow(/No effect\/sql runtime registered/);
    } finally {
      await context.close();
    }
  });
});
