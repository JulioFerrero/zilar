// `GET /api/agents/tasks/:taskId/steps` is owner only: an unknown task and a
// task owned by someone else answer the same 404. The card keeps at most 20
// steps however many stages a turn reports.
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

const MASTER_KEY = 'test-master-key-0000000000000000000000';
const PROVIDER_KEY = 'sk-provider-key-do-not-leak';
const CHAT_JID_SUFFIX = TEST_XMPP_DOMAIN;

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
        VALUES (${aiId}, ${ownerId}, ${'Steps AI'}, ${'dev'}, ${'A persona'}, ${connectionId}, ${'gpt-4o-mini'}, ${`ai-${aiId}`}, ${`ai-${aiId}@${TEST_XMPP_DOMAIN}`}, ${'active'})`;
    }),
  );
  return aiId;
}

describe('GET /api/agents/tasks/:taskId/steps', () => {
  let context: TestContext;
  let app: TestApp;
  let owner: SignedInUser;
  let stranger: SignedInUser;
  let taskId: string;
  let aiId: string;
  const base = Date.parse('2026-10-15T10:00:00.000Z');

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
    owner = await bootstrapUser(context, app, 'owner@example.com');
    stranger = await contactOf(context, app, owner.id, 'stranger@example.com');
    aiId = await seedAi(context, owner.id);
    taskId = randomUUID();
  });

  afterEach(async () => {
    await context.close();
  });

  async function insertEvent(input: {
    seq: number;
    kind: string;
    at: number;
    data: Record<string, unknown>;
  }): Promise<void> {
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO agent_task_events
            (id, task_id, ai_id, owner_id, chat_jid, seq, kind, at, duration_ms, data)
          VALUES (${randomUUID()}, ${taskId}, ${aiId}, ${owner.id},
            ${`${owner.id}@${CHAT_JID_SUFFIX}`}, ${input.seq}, ${input.kind},
            ${new Date(base + input.at).toISOString()}, ${null},
            ${JSON.stringify(input.data)}::jsonb)`;
      }),
    );
  }

  async function getSteps(cookie: string | null, id = taskId) {
    const headers: Record<string, string> = cookie === null ? {} : { cookie };
    const response = await app.request(
      `${TEST_BASE_URL}/api/agents/tasks/${id}/steps`,
      Object.keys(headers).length === 0 ? {} : { headers },
    );
    const json: unknown = await response.json().catch(() => null);
    return { status: response.status, json };
  }

  // 21 stages overflow the card's 20-step cap, so the card renames step-20 on
  // each stage past the cap and its label is the final stage's.
  it('caps the steps at 20 and renames the last with the final stage', async () => {
    await insertEvent({ seq: 1, kind: 'status', at: 0, data: { stage: 'Working on it' } });
    for (let index = 1; index <= 21; index += 1) {
      await insertEvent({
        seq: index + 1,
        kind: 'status',
        at: index * 1_000,
        data: { stage: `stage ${index}` },
      });
    }
    await insertEvent({ seq: 23, kind: 'status', at: 30_000, data: { stage: 'card_done' } });

    const { status, json } = await getSteps(owner.cookie);
    expect(status).toBe(200);
    const body = json as { steps: Array<{ id: string; label: string }> };
    expect(body.steps).toHaveLength(20);
    expect(body.steps.map((step) => step.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `step-${index + 1}`),
    );
    expect(body.steps.map((step) => step.label)).toEqual([
      ...Array.from({ length: 19 }, (_, index) => `stage ${index + 1}`),
      'stage 21',
    ]);
  });

  it('answers 404 for another user and for an unknown task', async () => {
    await insertEvent({ seq: 1, kind: 'status', at: 0, data: { stage: 'Working on it' } });
    expect((await getSteps(stranger.cookie)).status).toBe(404);
    expect((await getSteps(owner.cookie, randomUUID())).status).toBe(404);
  });

  it('answers 401 without a session', async () => {
    expect((await getSteps(null)).status).toBe(401);
  });
});
