// `GET /api/agents/tasks/:taskId/events` is owner only. An unknown task and a
// task owned by someone else answer the same 404.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createKeyCipher } from '../../connections/crypto';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  testApp,
  testSql,
  type SignedInUser,
  type TestApp,
  type TestContext,
} from '../../test-support';
import { createTurnLog } from './append';

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const PROVIDER_KEY = 'sk-provider-key-do-not-leak';

const wait = (ms = 15): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function seedAi(context: TestContext, ownerId: string): Promise<string> {
  const connectionId = randomUUID();
  const aiId = randomUUID();
  const encrypted = createKeyCipher(MASTER_KEY).encrypt(PROVIDER_KEY);
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label)
        VALUES (${connectionId}, ${ownerId}, ${'openai'}, ${encrypted}, ${null})`;
      yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status)
        VALUES (${aiId}, ${ownerId}, ${'Logger AI'}, ${'dev'}, ${'A persona'}, ${connectionId}, ${'gpt-4o-mini'}, ${`ai-${aiId}`}, ${`ai-${aiId}@${TEST_XMPP_DOMAIN}`}, ${'active'})`;
    }),
  );
  return aiId;
}

describe('GET /api/agents/tasks/:taskId/events', () => {
  let context: TestContext;
  let app: TestApp;
  let owner: SignedInUser;
  let stranger: SignedInUser;
  let taskId: string;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
    owner = await bootstrapUser(context, app, 'owner@example.com');
    stranger = await contactOf(context, app, owner.id, 'stranger@example.com');
    const aiId = await seedAi(context, owner.id);
    taskId = randomUUID();
    const log = createTurnLog({
      db: context.db,
      logger: { warn: () => undefined },
      taskId,
      aiId,
      ownerId: owner.id,
      chatJid: `${owner.id}@${TEST_XMPP_DOMAIN}`,
      secrets: [],
    });
    log.append('status', { stage: 'Running tests' });
    // Let the best-effort write land before the requests below.
    await wait(30);
  });

  afterEach(async () => {
    await context.close();
  });

  async function getEvents(cookie: string | null, id = taskId) {
    const headers: Record<string, string> = cookie === null ? {} : { cookie };
    const response = await app.request(
      `${TEST_BASE_URL}/api/agents/tasks/${id}/events`,
      Object.keys(headers).length === 0 ? {} : { headers },
    );
    const json: unknown = await response.json().catch(() => null);
    return { status: response.status, json };
  }

  it('answers 404 for another user and for an unknown task', async () => {
    expect((await getEvents(stranger.cookie)).status).toBe(404);
    expect((await getEvents(owner.cookie, randomUUID())).status).toBe(404);
  });

  it('answers 401 without a session', async () => {
    expect((await getEvents(null)).status).toBe(401);
  });
});
