// The effect/sql versions of the setup settings helpers (T-0667). They run on
// the same PGlite database the `setup/settings.ts` wrappers use, through the runtime that
// `createTestContext` registers. No real mail provider or API key is used.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { sqlRuntimeFor } from '../effect/sql';
import { createTestContext, type TestContext } from '../test-support';
import {
  deleteMailSettingsEffect,
  getMailSettingsEffect,
  needsSetupEffect,
  saveMailSettingsEffect,
  settingsCipherFor,
  takeSetupLockEffect,
} from './settings';

const SENTINEL_KEY = 're_ZILAR_EFFECT_SENTINEL_KEY_1a2b3c4d';
const SENTINEL_FROM = 'Zilar <setup-effect@example.com>';

let context: TestContext;

beforeEach(async () => {
  context = await createTestContext();
});

afterEach(async () => {
  await context.close();
});

describe('setup settings on effect/sql', () => {
  it('needsSetupEffect is true on an empty database', async () => {
    await expect(sqlRuntimeFor(context.db).runPromise(needsSetupEffect())).resolves.toBe(true);
  });

  it('saves the mail settings and reads them back decrypted', async () => {
    const cipher = settingsCipherFor(context.config);
    const runtime = sqlRuntimeFor(context.db);
    await runtime.runPromise(
      saveMailSettingsEffect(cipher, { resendApiKey: SENTINEL_KEY, from: SENTINEL_FROM }),
    );
    await expect(runtime.runPromise(getMailSettingsEffect(cipher))).resolves.toEqual({
      resendApiKey: SENTINEL_KEY,
      from: SENTINEL_FROM,
    });
  });

  it('returns null for the mail settings after delete', async () => {
    const cipher = settingsCipherFor(context.config);
    const runtime = sqlRuntimeFor(context.db);
    await runtime.runPromise(
      saveMailSettingsEffect(cipher, { resendApiKey: SENTINEL_KEY, from: SENTINEL_FROM }),
    );
    await runtime.runPromise(deleteMailSettingsEffect());
    await expect(runtime.runPromise(getMailSettingsEffect(cipher))).resolves.toBeNull();
  });

  it('takes the setup lock inside sql.withTransaction', async () => {
    const runtime = sqlRuntimeFor(context.db);
    const locked = Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient;
      return yield* client.withTransaction(takeSetupLockEffect());
    });
    await expect(runtime.runPromise(locked)).resolves.toBeUndefined();
  });
});
