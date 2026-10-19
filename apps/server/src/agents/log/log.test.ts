// The session log is best effort and must never leak a secret or a huge tool
// output.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createKeyCipher } from '../../connections/crypto';
import { createTestContext, TEST_XMPP_DOMAIN, testSql, type TestContext } from '../../test-support';
import { createTurnLog, TASK_EVENT_TEXT_MAX_BYTES } from './append';
import { listTaskEvents } from './api';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const PROVIDER_KEY = 'sk-provider-key-do-not-leak';

const wait = (ms = 15): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('agent task events', () => {
  let context: TestContext;
  let ownerId: string;
  let aiId: string;

  beforeEach(async () => {
    context = await createTestContext();
    ownerId = randomUUID();
    aiId = randomUUID();
    const connectionId = randomUUID();
    const encrypted = createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY);
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO "user" (id, name, email) VALUES (${ownerId}, ${'Owner'}, ${`${ownerId}@example.com`})`;
        yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label)
          VALUES (${connectionId}, ${ownerId}, ${'openai'}, ${encrypted}, ${null})`;
        yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status)
          VALUES (${aiId}, ${ownerId}, ${'Logger AI'}, ${'dev'}, ${'A persona'}, ${connectionId}, ${'gpt-4o-mini'}, ${`ai-${aiId}`}, ${`ai-${aiId}@${TEST_XMPP_DOMAIN}`}, ${'active'})`;
      }),
    );
  });

  afterEach(async () => {
    await context.close();
  });

  async function waitForEvents(taskId: string, count: number) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const page = await listTaskEvents(context.db, { taskId, ownerId, after: 0, limit: 100 });
      if (page.events.length >= count) {
        return page;
      }
      await wait();
    }
    return listTaskEvents(context.db, { taskId, ownerId, after: 0, limit: 100 });
  }

  it('redacts a secret and truncates a string to 2 KiB', async () => {
    const taskId = randomUUID();
    // No named secrets: the sk- backstop in `redactSecrets` is what must
    // catch the provider key.
    const log = createTurnLog({
      db: context.db,
      logger: { warn: () => undefined },
      taskId,
      aiId,
      ownerId,
      chatJid: `${ownerId}@${TEST_XMPP_DOMAIN}`,
      secrets: [],
    });
    log.append('tool_result', {
      tool: 'fetch',
      output: `${PROVIDER_KEY} ${'a'.repeat(TASK_EVENT_TEXT_MAX_BYTES * 2)}`,
    });

    const page = await waitForEvents(taskId, 1);
    const output = page.events[0]?.data.output;
    expect(typeof output).toBe('string');
    const text = output as string;
    expect(text).not.toContain(PROVIDER_KEY);
    expect(text).toContain('sk-***');
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(TASK_EVENT_TEXT_MAX_BYTES);
  });
});
