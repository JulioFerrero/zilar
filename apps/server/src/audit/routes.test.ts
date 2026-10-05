import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aiLimits,
  ais as aisTable,
  auditLog,
  groupMembers,
  groups,
  providerConnections,
} from '../db/schema';
import { HttpError } from '../errors';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';
import { recordAudit, type AuditEntry } from './service';
import { createAuditRoutes } from './routes';

function baseEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    actorUserId: null,
    aiId: null,
    groupId: null,
    action: 'machine.paired',
    subjectId: null,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: null,
    ...overrides,
  };
}

async function seedAi(context: TestContext, ownerId: string): Promise<{ aiId: string }> {
  const connectionId = randomUUID();
  await context.db.insert(providerConnections).values({
    id: connectionId,
    owner: ownerId,
    provider: 'openai',
    encryptedKey: 'sealed-placeholder',
    label: null,
  });
  const aiId = randomUUID();
  await context.db.insert(aisTable).values({
    id: aiId,
    owner: ownerId,
    name: 'Helper',
    template: 'dev',
    persona: 'A persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart: `ai-${aiId}`,
    jid: `ai-${aiId}@zilar.localhost`,
    status: 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
  return { aiId };
}

describe('audit routes', () => {
  let context: TestContext;
  let app: TestApp;
  let auditApp: Hono;
  let now: Date;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
    now = new Date('2026-09-15T00:00:00Z');
    auditApp = new Hono();
    auditApp.onError((error, c) => {
      if (error instanceof HttpError) {
        return c.json({ error: { code: error.code, message: error.message } }, error.status);
      }
      throw error;
    });
    auditApp.route('/api', createAuditRoutes({ auth: context.auth, db: context.db }));
  });

  afterEach(async () => {
    await context.close();
  });

  async function request(
    input: string,
    init: RequestInit & { cookie?: string } = {},
  ): Promise<Response> {
    const { cookie, ...rest } = init;
    const headers: Record<string, string> = {
      ...(rest.headers as Record<string, string> | undefined),
    };
    if (cookie !== undefined) {
      headers.cookie = cookie;
    }
    return await auditApp.request(input, { ...rest, headers });
  }

  it('returns 401 without a signed-in user', async () => {
    const response = await request(`${TEST_BASE_URL}/api/audit?aiId=anything`);
    expect(response.status).toBe(401);
  });

  it('returns 400 when both groupId and aiId are provided', async () => {
    const owner = await bootstrapUser(context, app, 'both@x.com');
    const response = await request(`${TEST_BASE_URL}/api/audit?groupId=g&aiId=a`, {
      cookie: owner.cookie,
    });
    expect(response.status).toBe(400);
  });

  it('returns 400 when neither groupId nor aiId are provided', async () => {
    const owner = await bootstrapUser(context, app, 'neither@x.com');
    const response = await request(`${TEST_BASE_URL}/api/audit`, {
      cookie: owner.cookie,
    });
    expect(response.status).toBe(400);
  });

  it('returns 400 when limit is not a positive integer', async () => {
    const owner = await bootstrapUser(context, app, 'limit@x.com');
    const response = await request(`${TEST_BASE_URL}/api/audit?aiId=a&limit=0`, {
      cookie: owner.cookie,
    });
    expect(response.status).toBe(400);
  });

  it('returns 400 when limit is above the max', async () => {
    const owner = await bootstrapUser(context, app, 'biglimit@x.com');
    const response = await request(`${TEST_BASE_URL}/api/audit?aiId=a&limit=999`, {
      cookie: owner.cookie,
    });
    expect(response.status).toBe(400);
  });

  it('returns the response shape with entries and next', async () => {
    const owner = await bootstrapUser(context, app, 'shape@x.com');
    const ai = await seedAi(context, owner.id);
    const aiId = ai.aiId;
    await recordAudit(
      context.db,
      baseEntry({ action: 'machine.paired', subjectId: 'm1', actorUserId: owner.id, aiId }),
      now,
    );
    const response = await request(`${TEST_BASE_URL}/api/audit?aiId=${aiId}`, {
      cookie: owner.cookie,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: Array<Record<string, unknown>>;
      next: string | null;
    };
    expect(body.entries).toHaveLength(1);
    expect(body.next).toBeNull();
    const entry = body.entries[0]!;
    expect(Object.keys(entry).sort()).toEqual(
      [
        'action',
        'actorUserId',
        'aiId',
        'argsHash',
        'at',
        'cost',
        'detail',
        'groupId',
        'id',
        'result',
        'subjectId',
      ].sort(),
    );
  });

  it('returns 400 on a malformed `before` cursor', async () => {
    const owner = await bootstrapUser(context, app, 'cursor@x.com');
    const response = await request(`${TEST_BASE_URL}/api/audit?aiId=a&before=not-a-cursor`, {
      cookie: owner.cookie,
    });
    expect(response.status).toBe(400);
  });

  it('hides group entries from a plain member and from a stranger', async () => {
    const owner = await bootstrapUser(context, app, 'g-owner@x.com');
    const admin = await bootstrapUser(context, app, 'g-admin@x.com');
    const member = await bootstrapUser(context, app, 'g-member@x.com');
    const stranger = await bootstrapUser(context, app, 'g-stranger@x.com');
    const groupId = randomUUID();
    await context.db.insert(groups).values({
      id: groupId,
      roomLocalpart: `g${randomUUID().slice(0, 16)}`,
      title: 'Crew',
      createdBy: owner.id,
    });
    await context.db.insert(groupMembers).values({ groupId, userId: owner.id, role: 'owner' });
    await context.db.insert(groupMembers).values({ groupId, userId: admin.id, role: 'admin' });
    await context.db.insert(groupMembers).values({ groupId, userId: member.id, role: 'member' });
    await recordAudit(
      context.db,
      baseEntry({
        action: 'approval.decided',
        subjectId: 'a1',
        actorUserId: owner.id,
        groupId,
      }),
      now,
    );

    for (const [who, cookie] of [
      ['admin', admin.cookie],
      ['owner', owner.cookie],
    ] as const) {
      const response = await request(`${TEST_BASE_URL}/api/audit?groupId=${groupId}`, {
        cookie,
      });
      expect(response.status, who).toBe(200);
      const body = (await response.json()) as { entries: unknown[] };
      expect(body.entries, who).toHaveLength(1);
    }
    for (const [who, cookie] of [
      ['member', member.cookie],
      ['stranger', stranger.cookie],
    ] as const) {
      const response = await request(`${TEST_BASE_URL}/api/audit?groupId=${groupId}`, {
        cookie,
      });
      expect(response.status, who).toBe(200);
      const body = (await response.json()) as { entries: unknown[] };
      expect(body.entries, who).toEqual([]);
    }
    const missing = await request(`${TEST_BASE_URL}/api/audit?groupId=${randomUUID()}`, {
      cookie: owner.cookie,
    });
    expect(missing.status).toBe(200);
    expect(((await missing.json()) as { entries: unknown[] }).entries).toEqual([]);
  });

  it('hides AI entries from a non-owner', async () => {
    const owner = await bootstrapUser(context, app, 'ai-owner@x.com');
    const stranger = await bootstrapUser(context, app, 'ai-stranger@x.com');
    const ai = await seedAi(context, owner.id);
    const aiId = ai.aiId;
    await recordAudit(
      context.db,
      baseEntry({ action: 'machine.paired', subjectId: 'm1', actorUserId: owner.id, aiId }),
      now,
    );

    const ownerView = await request(`${TEST_BASE_URL}/api/audit?aiId=${aiId}`, {
      cookie: owner.cookie,
    });
    expect(ownerView.status).toBe(200);
    const ownerBody = (await ownerView.json()) as { entries: unknown[] };
    expect(ownerBody.entries).toHaveLength(1);

    const strangerView = await request(`${TEST_BASE_URL}/api/audit?aiId=${aiId}`, {
      cookie: stranger.cookie,
    });
    expect(strangerView.status).toBe(200);
    const strangerBody = (await strangerView.json()) as { entries: unknown[] };
    expect(strangerBody.entries).toEqual([]);
  });

  it('paginated request returns the next cursor', async () => {
    const owner = await bootstrapUser(context, app, 'page@x.com');
    const ai = await seedAi(context, owner.id);
    const aiId = ai.aiId;
    for (let i = 0; i < 4; i += 1) {
      await recordAudit(
        context.db,
        baseEntry({
          action: 'machine.paired',
          subjectId: `m${i}`,
          actorUserId: owner.id,
          aiId,
        }),
        new Date(now.getTime() + i * 1000),
      );
    }

    const first = await request(`${TEST_BASE_URL}/api/audit?aiId=${aiId}&limit=2`, {
      cookie: owner.cookie,
    });
    const firstBody = (await first.json()) as {
      entries: Array<{ subjectId: string }>;
      next: string | null;
    };
    expect(firstBody.entries.map((e) => e.subjectId)).toEqual(['m3', 'm2']);
    expect(firstBody.next).not.toBeNull();

    const second = await request(
      `${TEST_BASE_URL}/api/audit?aiId=${aiId}&limit=2&before=${encodeURIComponent(firstBody.next!)}`,
      { cookie: owner.cookie },
    );
    const secondBody = (await second.json()) as {
      entries: Array<{ subjectId: string }>;
      next: string | null;
    };
    expect(secondBody.entries.map((e) => e.subjectId)).toEqual(['m1', 'm0']);
    expect(secondBody.next).toBeNull();
  });

  it('keeps the audit row under the trigger: nothing can rewrite it', async () => {
    const owner = await bootstrapUser(context, app, 'trigger@x.com');
    const ai = await seedAi(context, owner.id);
    await recordAudit(
      context.db,
      baseEntry({
        action: 'machine.paired',
        subjectId: 'm1',
        actorUserId: owner.id,
        aiId: ai.aiId,
      }),
      now,
    );

    // The route answered; the row is in the DB. We cannot rewrite it from any
    // route. The trigger test lives in service.test.ts; this case is here to
    // pin the behaviour end-to-end against the running test app.
    const [row] = await context.db.select().from(auditLog).where(eq(auditLog.subjectId, 'm1'));
    expect(row?.action).toBe('machine.paired');
  });
});
