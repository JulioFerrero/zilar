import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createAuditRecorder, type AuditEntry, type AuditRecorder } from '../audit/service';
import {
  aiLimits,
  ais,
  approvals,
  auditLog,
  groupAis,
  groupMembers,
  groups,
  pendingActions,
  providerConnections,
} from '../db/schema';
import {
  bootstrapUser,
  createTestContext,
  TEST_BASE_URL,
  type SignedInUser,
  type TestApp,
  type TestContext,
} from '../test-support';
import { topics, topicAis } from '../db/schema';
import {
  type ActionAdapter,
  type ActionRegistry,
  buildAlwaysEligible,
  buildRegistry,
} from './registry';
import {
  createActionGateway,
  type ActionAnnouncer,
  type ActionGateway,
  type ActionGatewayLogger,
} from './gateway';
import { buildToolAdapters } from '../tools/adapters';
import { approveToolHosts, saveToolVersion } from '../tools/service';
import type { ToolRunner } from '../tools/types';
import { listRoutinesForAi } from '../routines/service';

interface AdapterCall {
  ctx: { aiId: string; groupId: string | null; requestId: string };
  args: unknown;
}

interface FakeAdapter {
  name: string;
  adapter: ActionAdapter<unknown>;
  calls: AdapterCall[];
}

function tier0Adapter(): FakeAdapter {
  const calls: AdapterCall[] = [];
  const adapter: ActionAdapter<unknown> = {
    name: 'flow.tier0',
    description: 'Tier-0 adapter that records every call.',
    tier: 0,
    argsSchema: Schema.Struct({
      value: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
    }),
    describe: (args) => ({ summary: `tier0 ${(args as { value: string }).value}` }),
    execute: async (ctx, args) => {
      calls.push({ ctx, args });
      return { summary: `tier0-ran:${(args as { value: string }).value}` };
    },
  };
  return { name: adapter.name, adapter, calls };
}

function tier2Adapter(overrides: { throwWith?: string } = {}): FakeAdapter {
  const calls: AdapterCall[] = [];
  const adapter: ActionAdapter<unknown> = {
    name: 'flow.tier2',
    description: 'Tier-2 adapter that records every call.',
    tier: 2,
    argsSchema: Schema.Struct({
      value: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
    }),
    describe: (args) => ({ summary: `tier2 ${(args as { value: string }).value}` }),
    estimateCost: () => ({ currency: 'EUR' as const, amount: 1.25 }),
    execute: async (ctx, args) => {
      calls.push({ ctx, args });
      if (overrides.throwWith !== undefined) {
        throw new Error(overrides.throwWith);
      }
      return { summary: `tier2-ran:${(args as { value: string }).value}` };
    },
  };
  return { name: adapter.name, adapter, calls };
}

interface AnnouncerCalls {
  approvalRequested: Array<{ aiId: string; groupId: string | null; approvalId: string }>;
  outcome: Array<{
    aiId: string;
    groupId: string | null;
    status: 'executed' | 'failed' | 'cancelled';
    summary: string;
  }>;
}

function capturingAnnouncer(): { announcer: ActionAnnouncer; calls: AnnouncerCalls } {
  const calls: AnnouncerCalls = { approvalRequested: [], outcome: [] };
  const announcer: ActionAnnouncer = {
    async approvalRequested(input) {
      calls.approvalRequested.push(input);
    },
    async outcome(input) {
      calls.outcome.push(input);
    },
  };
  return { announcer, calls };
}

interface CapturingAudit extends AuditRecorder {
  entries: AuditEntry[];
}

function capturingAudit(db: TestContext['db']): CapturingAudit {
  const entries: AuditEntry[] = [];
  const real = createAuditRecorder({ db });
  return {
    entries,
    async record(entry: AuditEntry): Promise<void> {
      entries.push(entry);
      await real.record(entry);
    },
  };
}

interface Harness {
  context: TestContext;
  app: TestApp;
  gateway: ActionGateway;
  tier0: FakeAdapter;
  tier2: FakeAdapter;
  announcerCalls: AnnouncerCalls;
  audit: CapturingAudit;
}

async function seedAi(
  context: TestContext,
  ownerId: string,
  overrides: { status?: 'active' | 'disabled' | 'stopped' } = {},
): Promise<{ aiId: string }> {
  const connectionId = randomUUID();
  await context.db.insert(providerConnections).values({
    id: connectionId,
    owner: ownerId,
    provider: 'openai',
    encryptedKey: 'sealed-placeholder',
    label: null,
  });
  const aiId = randomUUID();
  const localpart = `ai-${aiId}`;
  const jid = `${localpart}@zilar.localhost`;
  await context.db.insert(ais).values({
    id: aiId,
    owner: ownerId,
    name: 'Helper',
    template: 'dev',
    persona: 'A persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart,
    jid,
    status: overrides.status ?? 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
  return { aiId };
}

async function buildHarness(tier2Overrides: { throwWith?: string } = {}): Promise<Harness> {
  const context = await createTestContext();
  const tier0 = tier0Adapter();
  const tier2 = tier2Adapter(tier2Overrides);
  const { announcer, calls: announcerCalls } = capturingAnnouncer();
  const audit = capturingAudit(context.db);
  const logger: ActionGatewayLogger = {
    warn: () => undefined,
    error: () => undefined,
  };
  const adapters: ActionRegistry = buildRegistry([tier0.adapter, tier2.adapter]);
  const gateway = createActionGateway({
    db: context.db,
    adapters,
    audit,
    logger,
    now: () => new Date(),
    announce: announcer,
  });
  const app = createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
    adminClient: context.adminClient,
    audit,
    actionGateway: gateway,
  });
  return { context, app, gateway, tier0, tier2, announcerCalls, audit };
}

async function requestTier2(harness: Harness, aiId: string): Promise<string> {
  const outcome = await harness.gateway.request({
    aiId,
    action: 'flow.tier2',
    args: { value: 'spicy' },
    requestedBy: 'ai-bot@zilar.localhost',
  });
  if (outcome.status !== 'pending_approval') {
    throw new Error(`expected pending_approval, got ${outcome.status}`);
  }
  return outcome.approvalId;
}

async function decide(
  harness: Harness,
  cookie: string,
  approvalId: string,
  decision: 'approve_once' | 'approve_always' | 'deny',
): Promise<Response> {
  return harness.app.request(`${TEST_BASE_URL}/api/approvals/${approvalId}/decision`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
}

async function waitForPendingStatus(
  harness: Harness,
  approvalId: string,
  status: 'executed' | 'failed' | 'cancelled' | 'waiting',
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<typeof pendingActions.$inferSelect> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const intervalMs = options.intervalMs ?? 20;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const [row] = await harness.context.db
      .select()
      .from(pendingActions)
      .where(eq(pendingActions.approvalId, approvalId))
      .limit(1);
    if (row && row.status === status) {
      return row;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  const [finalRow] = await harness.context.db
    .select()
    .from(pendingActions)
    .where(eq(pendingActions.approvalId, approvalId))
    .limit(1);
  throw new Error(
    `pending action did not reach status "${status}" within ${timeoutMs}ms (last status: ${finalRow?.status ?? 'missing'})`,
  );
}

async function waitForCallCount(
  adapter: FakeAdapter,
  count: number,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<AdapterCall[]> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const intervalMs = options.intervalMs ?? 20;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (adapter.calls.length === count) {
      return adapter.calls;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `adapter call count never reached ${count} within ${timeoutMs}ms (got ${adapter.calls.length})`,
  );
}

async function signInOwner(
  harness: Harness,
  suffix: string,
): Promise<{ owner: SignedInUser; aiId: string }> {
  const owner = await bootstrapUser(harness.context, harness.app, `owner-${suffix}@example.com`);
  const { aiId } = await seedAi(harness.context, owner.id);
  return { owner, aiId };
}

describe('action flow e2e through real HTTP routes (T-0096)', () => {
  let harness: Harness;
  let testCounter = 0;

  beforeEach(async () => {
    testCounter += 1;
    harness = await buildHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  // 1) Approve runs the adapter once with the stored parsed args; the
  // pending row is `executed` with the adapter's success summary; the
  // announcer got the card and the executed outcome; audit has the three
  // entries with the hash and no args text.
  it('approve_once runs the adapter once with the stored args and emits the right signals', async () => {
    const { owner, aiId } = await signInOwner(harness, `approve-${testCounter}`);
    const approvalId = await requestTier2(harness, aiId);

    const response = await decide(harness, owner.cookie, approvalId, 'approve_once');
    expect(response.status).toBe(200);

    const row = await waitForPendingStatus(harness, approvalId, 'executed');
    expect(row.resultSummary).toBe('tier2-ran:spicy');

    const calls = await waitForCallCount(harness.tier2, 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual({ value: 'spicy' });
    expect(calls[0]?.ctx).toMatchObject({ aiId, groupId: null });

    expect(harness.announcerCalls.approvalRequested).toEqual([{ aiId, groupId: null, approvalId }]);
    expect(harness.announcerCalls.outcome).toEqual([
      { aiId, groupId: null, status: 'executed', summary: 'tier2-ran:spicy' },
    ]);

    const auditByAction = new Map(harness.audit.entries.map((entry) => [entry.action, entry]));
    expect(auditByAction.has('action.requested')).toBe(true);
    expect(auditByAction.has('approval.decided')).toBe(true);
    expect(auditByAction.has('action.executed')).toBe(true);

    const requested = auditByAction.get('action.requested');
    expect(requested?.subjectId).toBe(approvalId);
    expect(requested?.argsHash).toMatch(/^[0-9a-f]{64}$/);

    const decided = auditByAction.get('approval.decided');
    expect(decided?.subjectId).toBe(approvalId);
    expect(decided?.actorUserId).toBe(owner.id);

    const executed = auditByAction.get('action.executed');
    expect(executed?.result).toBe('ok');

    const auditRows = await harness.context.db.select().from(auditLog);
    const allAudit = JSON.stringify({ rows: auditRows, entries: harness.audit.entries });
    expect(allAudit).not.toContain('spicy');
    expect(allAudit).not.toContain('value');
  });

  // 2) Deny never runs the adapter; the pending row is `cancelled` and the
  // announcer got `outcome(cancelled)`.
  it('deny cancels without running the adapter and announces the cancellation', async () => {
    const { owner, aiId } = await signInOwner(harness, `deny-${testCounter}`);
    const approvalId = await requestTier2(harness, aiId);

    const response = await decide(harness, owner.cookie, approvalId, 'deny');
    expect(response.status).toBe(200);

    const row = await waitForPendingStatus(harness, approvalId, 'cancelled');
    expect(row.status).toBe('cancelled');

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(harness.tier2.calls).toHaveLength(0);

    expect(harness.announcerCalls.approvalRequested).toEqual([{ aiId, groupId: null, approvalId }]);
    expect(harness.announcerCalls.outcome).toEqual([
      { aiId, groupId: null, status: 'cancelled', summary: 'The request was not carried out.' },
    ]);
  });

  // 3) A stranger's decision answers 404; the adapter never runs; the row
  // stays waiting; the owner can still approve and it runs once.
  it('a stranger cannot decide and the owner can still approve afterwards', async () => {
    const owner = await bootstrapUser(
      harness.context,
      harness.app,
      `owner-stranger-${testCounter}@example.com`,
    );
    const stranger = await bootstrapUser(
      harness.context,
      harness.app,
      `stranger-${testCounter}@example.com`,
    );
    const { aiId } = await seedAi(harness.context, owner.id);
    const approvalId = await requestTier2(harness, aiId);

    const strangerResponse = await decide(harness, stranger.cookie, approvalId, 'approve_once');
    expect(strangerResponse.status).toBe(404);
    const body = (await strangerResponse.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');

    const [pendingAfterStranger] = await harness.context.db
      .select()
      .from(pendingActions)
      .where(eq(pendingActions.approvalId, approvalId));
    expect(pendingAfterStranger?.status).toBe('waiting');
    expect(harness.tier2.calls).toHaveLength(0);

    const ownerResponse = await decide(harness, owner.cookie, approvalId, 'approve_once');
    expect(ownerResponse.status).toBe(200);

    await waitForPendingStatus(harness, approvalId, 'executed');
    const calls = await waitForCallCount(harness.tier2, 1);
    expect(calls).toHaveLength(1);
  });

  // 4) Two approval calls back-to-back: the second answers 409 (route's
  // conflict shape) and the adapter runs exactly once.
  it('a second decision answers 409 and the adapter still runs exactly once', async () => {
    const { owner, aiId } = await signInOwner(harness, `double-${testCounter}`);
    const approvalId = await requestTier2(harness, aiId);

    const first = await decide(harness, owner.cookie, approvalId, 'approve_once');
    expect(first.status).toBe(200);

    const second = await decide(harness, owner.cookie, approvalId, 'deny');
    expect(second.status).toBe(409);
    const secondBody = (await second.json()) as { error: { code: string } };
    expect(secondBody.error.code).toBe('not_pending');

    await waitForPendingStatus(harness, approvalId, 'executed');
    const calls = await waitForCallCount(harness.tier2, 1);
    expect(calls).toHaveLength(1);
  });

  // 5) Stop the AI between request and approval; the decision answers 200,
  // the onDecided hook finds a non-active AI and cancels without running.
  it('stopping the AI between request and approval cancels without running', async () => {
    const { owner, aiId } = await signInOwner(harness, `stop-${testCounter}`);
    const approvalId = await requestTier2(harness, aiId);

    const stopResponse = await harness.app.request(`${TEST_BASE_URL}/api/ais/${aiId}/stop`, {
      method: 'POST',
      headers: { cookie: owner.cookie },
    });
    expect(stopResponse.status).toBe(200);

    const decisionResponse = await decide(harness, owner.cookie, approvalId, 'approve_once');
    expect(decisionResponse.status).toBe(200);

    const row = await waitForPendingStatus(harness, approvalId, 'cancelled');
    expect(row.status).toBe('cancelled');

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(harness.tier2.calls).toHaveLength(0);

    const cancelledAudit = harness.audit.entries.find(
      (entry) => entry.action === 'action.cancelled',
    );
    expect(cancelledAudit).toBeDefined();
    expect(cancelledAudit?.result).toBe('denied');
  });

  // 6) An expired approval's decision is refused; the adapter never runs.
  it('an expired approval is refused at decision time and the adapter never runs', async () => {
    const { owner, aiId } = await signInOwner(harness, `expiry-${testCounter}`);
    const approvalId = await requestTier2(harness, aiId);

    await harness.context.db
      .update(approvals)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(approvals.id, approvalId));

    const response = await decide(harness, owner.cookie, approvalId, 'approve_once');
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('expired');

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(harness.tier2.calls).toHaveLength(0);

    const [row] = await harness.context.db
      .select()
      .from(pendingActions)
      .where(eq(pendingActions.approvalId, approvalId));
    expect(row?.status).toBe('waiting');
  });

  // 7) Tier 0 needs no approval: the request runs the adapter immediately
  // and writes no pending row.
  it('tier 0 runs immediately with no approval or pending row', async () => {
    const { aiId } = await signInOwner(harness, `tier0-${testCounter}`);
    const outcome = await harness.gateway.request({
      aiId,
      action: 'flow.tier0',
      args: { value: 'fast' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    expect(outcome).toEqual({ status: 'executed', summary: 'tier0-ran:fast' });

    expect(harness.tier0.calls).toHaveLength(1);
    expect(harness.tier0.calls[0]?.args).toEqual({ value: 'fast' });

    const pendingRows = await harness.context.db.select().from(pendingActions);
    expect(pendingRows).toHaveLength(0);
    const approvalRows = await harness.context.db.select().from(approvals);
    expect(approvalRows).toHaveLength(0);

    expect(harness.announcerCalls.approvalRequested).toEqual([]);
    expect(harness.announcerCalls.outcome).toEqual([]);
  });

  // 8) Unknown action and invalid args are denied with the right reason
  // and leave no approval or pending row.
  it('unknown action and invalid args are denied without leaving any row behind', async () => {
    const { aiId } = await signInOwner(harness, `deny-row-${testCounter}`);

    const unknown = await harness.gateway.request({
      aiId,
      action: 'flow.does_not_exist',
      args: { value: 'x' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    expect(unknown).toEqual({ status: 'denied', reason: 'unknown_action' });

    const invalid = await harness.gateway.request({
      aiId,
      action: 'flow.tier2',
      args: { value: 42 },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    expect(invalid).toEqual({ status: 'denied', reason: 'invalid_args' });

    const pendingRows = await harness.context.db.select().from(pendingActions);
    expect(pendingRows).toHaveLength(0);
    const approvalRows = await harness.context.db.select().from(approvals);
    expect(approvalRows).toHaveLength(0);
    expect(harness.tier2.calls).toHaveLength(0);
  });

  // 9) Tampering with the args_hash after a request means the gateway's
  // verify step disagrees with the approval, so the adapter never runs.
  it('tampering with the stored hash cancels the row and never runs the adapter', async () => {
    const { owner, aiId } = await signInOwner(harness, `tamper-${testCounter}`);
    const approvalId = await requestTier2(harness, aiId);

    await harness.context.db
      .update(pendingActions)
      .set({ argsHash: 'a'.repeat(64) })
      .where(eq(pendingActions.approvalId, approvalId));

    const response = await decide(harness, owner.cookie, approvalId, 'approve_once');
    expect(response.status).toBe(200);

    const row = await waitForPendingStatus(harness, approvalId, 'cancelled');
    expect(row.status).toBe('cancelled');

    expect(harness.tier2.calls).toHaveLength(0);

    const cancelledAudit = harness.audit.entries.find(
      (entry) => entry.action === 'action.cancelled',
    );
    expect(cancelledAudit).toBeDefined();
  });

  // 10) An adapter that throws turns the pending row to `failed` and the
  // distinct throw text appears nowhere — not in rows, not in audit, not
  // in the announcer payload, not in the HTTP response.
  it('an adapter throw never leaks the thrown message anywhere', async () => {
    await harness.context.close();
    harness = await buildHarness({ throwWith: 'SECRET-DO-NOT-LEAK' });

    const { owner, aiId } = await signInOwner(harness, `throw-${testCounter}`);
    const approvalId = await requestTier2(harness, aiId);

    const response = await decide(harness, owner.cookie, approvalId, 'approve_once');
    expect(response.status).toBe(200);
    const responseText = await response.text();
    expect(responseText).not.toContain('SECRET-DO-NOT-LEAK');

    const row = await waitForPendingStatus(harness, approvalId, 'failed');
    expect(row.status).toBe('failed');

    const auditRows = await harness.context.db.select().from(auditLog);
    const allAudit = JSON.stringify({ rows: auditRows, entries: harness.audit.entries });
    expect(allAudit).not.toContain('SECRET-DO-NOT-LEAK');

    const allAnnouncer = JSON.stringify(harness.announcerCalls);
    expect(allAnnouncer).not.toContain('SECRET-DO-NOT-LEAK');

    const failedAudit = harness.audit.entries.find((entry) => entry.action === 'action.failed');
    expect(failedAudit).toBeDefined();
    expect(failedAudit?.result).toBe('error');

    const outcome = harness.announcerCalls.outcome[0];
    expect(outcome?.status).toBe('failed');
    expect(outcome?.summary).toBe('The action failed.');
  });

  // 11) T-0101: only a group admin can create a group "always" rule. The
  // AI owner (a plain group member) sees no third option
  // (`alwaysEligible: false`), forcing `approve_always` answers 403 and
  // changes nothing, then `approve_once` runs the action; an admin's
  // `approve_always` creates the rule and the next request in that group
  // auto-executes.
  it('a plain-member owner cannot always-allow in a group but an admin can', async () => {
    const alwaysAdapter: ActionAdapter<unknown> = {
      name: 'flow.always',
      description: 'Tier-2 adapter that opts into always-allow.',
      tier: 2,
      argsSchema: Schema.Struct({
        value: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
      }),
      describe: (args) => ({ summary: `always ${(args as { value: string }).value}` }),
      allowAlways: true,
      execute: async (_ctx, args) => {
        return { summary: `always-ran:${(args as { value: string }).value}` };
      },
    };
    const adapters: ActionRegistry = buildRegistry([
      harness.tier0.adapter,
      harness.tier2.adapter,
      alwaysAdapter,
    ]);
    const alwaysEligible = buildAlwaysEligible(adapters);
    const gateway = createActionGateway({
      db: harness.context.db,
      adapters,
      audit: harness.audit,
      logger: {
        warn: () => undefined,
        error: () => undefined,
      },
      now: () => new Date(),
      announce: {
        approvalRequested: async (input) => {
          harness.announcerCalls.approvalRequested.push(input);
        },
        outcome: async (input) => {
          harness.announcerCalls.outcome.push(input);
        },
      },
    });
    const app = createApp({
      db: harness.context.db,
      logger: harness.context.logger,
      config: harness.context.config,
      auth: harness.context.auth,
      adminClient: harness.context.adminClient,
      audit: harness.audit,
      actionGateway: gateway,
      alwaysEligible,
    });
    harness.app = app;
    harness.gateway = gateway;

    const owner = await bootstrapUser(
      harness.context,
      harness.app,
      `owner-always-${testCounter}@example.com`,
    );
    const admin = await bootstrapUser(
      harness.context,
      harness.app,
      `admin-always-${testCounter}@example.com`,
    );
    const { aiId } = await seedAi(harness.context, owner.id);
    const groupId = randomUUID();
    await harness.context.db.insert(groups).values({
      id: groupId,
      roomLocalpart: `g${randomUUID().replace(/-/g, '').slice(0, 15)}`,
      title: 'Always group',
      createdBy: admin.id,
    });
    await harness.context.db.insert(groupMembers).values([
      { groupId, userId: owner.id, role: 'member' },
      { groupId, userId: admin.id, role: 'admin' },
    ]);
    await harness.context.db.insert(groupAis).values({ groupId, aiId, addedBy: admin.id });
    // T-0110: group scope is always a topic; the old group scope lives on
    // the General topic.
    const generalTopicId = randomUUID();
    await harness.context.db.insert(topics).values({
      id: generalTopicId,
      groupId,
      name: 'General',
      glyph: 'G',
      roomLocalpart: `g${randomUUID().replace(/-/g, '').slice(0, 15)}`,
      visibility: 'public',
      kind: 'chat',
      status: 'open',
      isGeneral: true,
      createdBy: admin.id,
    });

    async function requestInGroup(value: string): Promise<string> {
      const outcome = await harness.gateway.request({
        aiId,
        groupId,
        topicId: generalTopicId,
        action: 'flow.always',
        args: { value },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      if (outcome.status !== 'pending_approval') {
        throw new Error(`expected pending_approval, got ${outcome.status}`);
      }
      return outcome.approvalId;
    }

    async function readCard(
      cookie: string,
      approvalId: string,
    ): Promise<{ alwaysEligible: boolean }> {
      const response = await harness.app.request(`${TEST_BASE_URL}/api/approvals/${approvalId}`, {
        headers: { cookie },
      });
      expect(response.status).toBe(200);
      return (await response.json()) as { alwaysEligible: boolean };
    }

    // The plain-member owner sees no third option.
    const memberApprovalId = await requestInGroup('first');
    expect((await readCard(owner.cookie, memberApprovalId)).alwaysEligible).toBe(false);
    // The admin sees it on the same card.
    expect((await readCard(admin.cookie, memberApprovalId)).alwaysEligible).toBe(true);

    // Forcing `approve_always` as the member answers 403 and changes nothing.
    const refused = await decide(harness, owner.cookie, memberApprovalId, 'approve_always');
    expect(refused.status).toBe(403);
    const refusedBody = (await refused.json()) as { error: { code: string } };
    expect(refusedBody.error.code).toBe('always_requires_admin');

    // The same person approves once and the action runs.
    const approved = await decide(harness, owner.cookie, memberApprovalId, 'approve_once');
    expect(approved.status).toBe(200);
    await waitForPendingStatus(harness, memberApprovalId, 'executed');

    // An admin's `approve_always` creates the rule; the next request in
    // that group auto-executes with no new approval row.
    const adminApprovalId = await requestInGroup('second');
    const adminDecision = await decide(harness, admin.cookie, adminApprovalId, 'approve_always');
    expect(adminDecision.status).toBe(200);
    await waitForPendingStatus(harness, adminApprovalId, 'executed');

    const rulesResponse = await harness.app.request(
      `${TEST_BASE_URL}/api/groups/${groupId}/approval-rules`,
      { headers: { cookie: admin.cookie } },
    );
    expect(rulesResponse.status).toBe(200);
    const rules = (await rulesResponse.json()) as Array<{ groupId: string | null }>;
    expect(rules).toHaveLength(1);
    expect(rules[0]?.groupId).toBe(groupId);

    const approvalCountBefore = (await harness.context.db.select().from(approvals)).length;
    const auto = await harness.gateway.request({
      aiId,
      groupId,
      topicId: generalTopicId,
      action: 'flow.always',
      args: { value: 'third' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    expect(auto).toEqual({ status: 'executed', summary: 'always-ran:third' });
    const approvalCountAfter = (await harness.context.db.select().from(approvals)).length;
    expect(approvalCountAfter).toBe(approvalCountBefore);
  });

  // 12) T-0110: a tier-2 request raised in a topic stores the topic on the
  // approval and the pending action, and the card + outcome notice carry
  // the topic id to the announcer (which posts them into the topic room).
  // A standing rule created in topic A fires in A only, never in topic B.
  it('a topic request stores topic_id and announces the card and outcome into the topic', async () => {
    const alwaysAdapter: ActionAdapter<unknown> = {
      name: 'flow.always',
      description: 'Tier-2 adapter that opts into always-allow.',
      tier: 2,
      argsSchema: Schema.Struct({
        value: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
      }),
      describe: (args) => ({ summary: `always ${(args as { value: string }).value}` }),
      allowAlways: true,
      execute: async (_ctx, args) => {
        return { summary: `always-ran:${(args as { value: string }).value}` };
      },
    };
    const adapters: ActionRegistry = buildRegistry([
      harness.tier0.adapter,
      harness.tier2.adapter,
      alwaysAdapter,
    ]);
    const alwaysEligible = buildAlwaysEligible(adapters);
    const gateway = createActionGateway({
      db: harness.context.db,
      adapters,
      audit: harness.audit,
      logger: {
        warn: () => undefined,
        error: () => undefined,
      },
      now: () => new Date(),
      announce: {
        approvalRequested: async (input) => {
          harness.announcerCalls.approvalRequested.push(input);
        },
        outcome: async (input) => {
          harness.announcerCalls.outcome.push(input);
        },
      },
    });
    const app = createApp({
      db: harness.context.db,
      logger: harness.context.logger,
      config: harness.context.config,
      auth: harness.context.auth,
      adminClient: harness.context.adminClient,
      audit: harness.audit,
      actionGateway: gateway,
      alwaysEligible,
    });
    harness.app = app;
    harness.gateway = gateway;

    const owner = await bootstrapUser(
      harness.context,
      harness.app,
      `owner-topic-${testCounter}@example.com`,
    );
    const admin = await bootstrapUser(
      harness.context,
      harness.app,
      `admin-topic-${testCounter}@example.com`,
    );
    const { aiId } = await seedAi(harness.context, owner.id);
    const groupId = randomUUID();
    await harness.context.db.insert(groups).values({
      id: groupId,
      roomLocalpart: `g${randomUUID().replace(/-/g, '').slice(0, 15)}`,
      title: 'Topic group',
      createdBy: admin.id,
    });
    await harness.context.db.insert(groupMembers).values([
      { groupId, userId: owner.id, role: 'member' },
      { groupId, userId: admin.id, role: 'admin' },
    ]);
    await harness.context.db.insert(groupAis).values({ groupId, aiId, addedBy: admin.id });
    const topicA = randomUUID();
    const topicB = randomUUID();
    await harness.context.db.insert(topics).values([
      {
        id: topicA,
        groupId,
        name: 'General',
        glyph: 'G',
        roomLocalpart: `g${randomUUID().replace(/-/g, '').slice(0, 15)}`,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: true,
        createdBy: admin.id,
      },
      {
        id: topicB,
        groupId,
        name: 'Build',
        glyph: 'B',
        roomLocalpart: `g${randomUUID().replace(/-/g, '').slice(0, 15)}`,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: false,
        createdBy: admin.id,
      },
    ]);
    // The AI works in both topics (General via `group_ais`, Build via a
    // `topic_ais` row); the rule created below still fires in A only.
    await harness.context.db.insert(topicAis).values({ topicId: topicB, aiId, addedBy: admin.id });

    // The request in topic A is pending; the card carries topic A.
    // (`flow.always` is the always-eligible action, so the member-owner
    // 403 check below exercises the admin gate, not eligibility.)
    const outcome = await harness.gateway.request({
      aiId,
      groupId,
      topicId: topicA,
      action: 'flow.always',
      args: { value: 'spicy' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    if (outcome.status !== 'pending_approval') {
      throw new Error(`expected pending_approval, got ${outcome.status}`);
    }
    expect(harness.announcerCalls.approvalRequested).toEqual([
      { aiId, groupId, topicId: topicA, approvalId: outcome.approvalId },
    ]);
    const [approval] = await harness.context.db
      .select()
      .from(approvals)
      .where(eq(approvals.id, outcome.approvalId));
    expect(approval?.topicId).toBe(topicA);

    // The plain-member AI owner still cannot always-allow in the topic
    // (T-0101 holds per topic): 403, then approve_once runs and the
    // outcome notice carries the topic.
    const refused = await decide(harness, owner.cookie, outcome.approvalId, 'approve_always');
    expect(refused.status).toBe(403);
    const approved = await decide(harness, owner.cookie, outcome.approvalId, 'approve_once');
    expect(approved.status).toBe(200);
    await waitForPendingStatus(harness, outcome.approvalId, 'executed');
    expect(harness.announcerCalls.outcome).toEqual([
      {
        aiId,
        groupId,
        topicId: topicA,
        status: 'executed',
        summary: 'always-ran:spicy',
      },
    ]);

    // An admin's approve_always in topic A creates a rule scoped to A: the
    // next request in A auto-runs, while B still needs a card.
    const adminOutcome = await harness.gateway.request({
      aiId,
      groupId,
      topicId: topicA,
      action: 'flow.always',
      args: { value: 'second' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    if (adminOutcome.status !== 'pending_approval') {
      throw new Error(`expected pending_approval, got ${adminOutcome.status}`);
    }
    const adminDecision = await decide(
      harness,
      admin.cookie,
      adminOutcome.approvalId,
      'approve_always',
    );
    expect(adminDecision.status).toBe(200);
    await waitForPendingStatus(harness, adminOutcome.approvalId, 'executed');

    const auto = await harness.gateway.request({
      aiId,
      groupId,
      topicId: topicA,
      action: 'flow.always',
      args: { value: 'third' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    expect(auto).toEqual({ status: 'executed', summary: 'always-ran:third' });

    const inB = await harness.gateway.request({
      aiId,
      groupId,
      topicId: topicB,
      action: 'flow.always',
      args: { value: 'other-topic' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    expect(inB.status).toBe('pending_approval');
  });
});

describe('tool and routine adapters e2e through the gateway HTTP flow (T-0105)', () => {
  let harness: Harness;
  let testCounter = 0;

  const fakeRunner: ToolRunner = () =>
    Promise.resolve({
      ok: true,
      output: { text: 'BTC 100' },
      logs: '',
      durationMs: 5,
      fetchCount: 0,
    });

  async function buildToolsHarness(): Promise<{
    owner: SignedInUser;
    aiId: string;
    groupId: string;
    generalTopicId: string;
    posts: Array<{ aiId: string; groupId: string | null; topicId?: string; text: string }>;
  }> {
    const context = harness.context;
    const owner = await bootstrapUser(
      context,
      harness.app,
      `tools-owner-${testCounter}@example.com`,
    );
    const { aiId } = await seedAi(context, owner.id);
    const groupId = randomUUID();
    await context.db.insert(groups).values({
      id: groupId,
      roomLocalpart: `g${randomUUID().replace(/-/g, '').slice(0, 15)}`,
      title: 'Tools group',
      createdBy: owner.id,
    });
    await context.db.insert(groupMembers).values([{ groupId, userId: owner.id, role: 'member' }]);
    await context.db.insert(groupAis).values({ groupId, aiId, addedBy: owner.id });
    const generalTopicId = randomUUID();
    await context.db.insert(topics).values({
      id: generalTopicId,
      groupId,
      name: 'General',
      glyph: 'G',
      roomLocalpart: `g${randomUUID().replace(/-/g, '').slice(0, 15)}`,
      visibility: 'public',
      kind: 'chat',
      status: 'open',
      isGeneral: true,
      createdBy: owner.id,
    });

    const posts: Array<{
      aiId: string;
      groupId: string | null;
      topicId?: string;
      text: string;
    }> = [];
    const audit = harness.audit;
    const gateway = createActionGateway({
      db: context.db,
      adapters: buildRegistry(
        buildToolAdapters({
          db: context.db,
          runner: fakeRunner,
          audit,
          now: () => new Date(),
          post: async (post) => {
            posts.push(post);
            return true;
          },
        }),
      ),
      audit,
      logger: {
        warn: () => undefined,
        error: () => undefined,
      },
      now: () => new Date(),
      announce: {
        approvalRequested: async (input) => {
          harness.announcerCalls.approvalRequested.push(input);
        },
        outcome: async (input) => {
          harness.announcerCalls.outcome.push(input);
        },
      },
    });
    harness.gateway = gateway;
    harness.app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
      audit,
      actionGateway: gateway,
      alwaysEligible: buildAlwaysEligible(
        buildRegistry(
          buildToolAdapters({
            db: context.db,
            runner: fakeRunner,
            now: () => new Date(),
            post: async () => true,
          }),
        ),
      ),
    });
    return { owner, aiId, groupId, generalTopicId, posts };
  }

  async function saveTool(
    aiId: string,
    groupId: string,
    topicId: string,
    ownerId: string,
    hosts: string[] = ['api.example.com'],
  ): Promise<void> {
    // T-0132: newly saved tools start with an empty approved set, so
    // approve the declared hosts — every existing scenario predates the
    // tool-host check in `routine.schedule`.
    const { tool } = await saveToolVersion(
      harness.context.db,
      {
        aiId,
        groupId,
        topicId,
        name: 'prices',
        description: 'Posts the prices',
        source: 'return { text: "BTC 100" };',
        hosts,
        message: 'First version',
        userId: ownerId,
      },
      new Date(),
    );
    await approveToolHosts(
      harness.context.db,
      { toolId: tool.id, hosts, userId: ownerId },
      new Date(),
    );
  }

  function scheduleArgs(hosts: string[] = ['api.example.com']) {
    return {
      tool: 'prices',
      title: 'Morning prices',
      schedule: { kind: 'daily', time: '09:00', timezone: 'Europe/Madrid' },
      hosts,
    };
  }

  beforeEach(async () => {
    testCounter += 1;
    harness = await buildHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  // 13) `routine.schedule` end to end: request → approval card lists the
  // hosts → approve once → the routine exists with `approvedHosts`; the
  // card payload reached the announcer with the hosts in the details.
  // T-0132: the tool's hosts were approved first (`saveTool` does that),
  // so the schedule's card hosts sit inside the tool's approved set.
  it('routine.schedule runs through the approval flow and creates the routine', async () => {
    const { owner, aiId, groupId, generalTopicId } = await buildToolsHarness();
    await saveTool(aiId, groupId, generalTopicId, owner.id);

    const outcome = await harness.gateway.request({
      aiId,
      groupId,
      topicId: generalTopicId,
      action: 'routine.schedule',
      args: scheduleArgs(),
      requestedBy: 'ai-bot@zilar.localhost',
    });
    if (outcome.status !== 'pending_approval') {
      throw new Error(`expected pending_approval, got ${outcome.status}`);
    }
    const [approval] = await harness.context.db
      .select()
      .from(approvals)
      .where(eq(approvals.id, outcome.approvalId));
    expect(approval?.summary).toBe('Schedule "Morning prices": daily at 09:00 Europe/Madrid');
    expect(approval?.details).toContain('api.example.com');
    expect(approval?.topicId).toBe(generalTopicId);

    const response = await decide(harness, owner.cookie, outcome.approvalId, 'approve_once');
    expect(response.status).toBe(200);
    await waitForPendingStatus(harness, outcome.approvalId, 'executed');

    const routines = await listRoutinesForAi(harness.context.db, aiId);
    expect(routines).toHaveLength(1);
    expect(routines[0]?.title).toBe('Morning prices');
    expect(routines[0]?.approvedHosts).toEqual(['api.example.com']);
    expect(routines[0]?.topicId).toBe(generalTopicId);

    // No tool source, output or fetched string reaches the audit rows or
    // the announcer payloads made during the full scenario. (The tool
    // hosts legitimately appear in the approval card details — the human
    // must see which sites the routine will contact — so only source and
    // output are asserted absent here.)
    const auditRows = await harness.context.db.select().from(auditLog);
    const withoutCardDetails = JSON.stringify({
      rows: auditRows,
      entries: harness.audit.entries,
    });
    expect(withoutCardDetails).not.toContain('return { text: "BTC 100" };');
    expect(withoutCardDetails).not.toContain('BTC 100');
    const announcerWithoutOutcomes = JSON.stringify(harness.announcerCalls.approvalRequested);
    expect(announcerWithoutOutcomes).not.toContain('return { text: "BTC 100" };');
  });

  // 14) A tool update that changes hosts between request and approval fails
  // safe: the gateway reports `failed` and no routine is created.
  it('a hosts change between request and approval fails without creating a routine', async () => {
    const { owner, aiId, groupId, generalTopicId } = await buildToolsHarness();
    await saveTool(aiId, groupId, generalTopicId, owner.id);

    const outcome = await harness.gateway.request({
      aiId,
      groupId,
      topicId: generalTopicId,
      action: 'routine.schedule',
      args: scheduleArgs(),
      requestedBy: 'ai-bot@zilar.localhost',
    });
    if (outcome.status !== 'pending_approval') {
      throw new Error(`expected pending_approval, got ${outcome.status}`);
    }
    await saveToolVersion(
      harness.context.db,
      {
        aiId,
        groupId,
        topicId: generalTopicId,
        name: 'prices',
        description: 'Posts the prices',
        source: 'return { text: "BTC 100" };',
        hosts: ['changed.example.com'],
        message: 'New host',
        userId: owner.id,
      },
      new Date(),
    );

    const response = await decide(harness, owner.cookie, outcome.approvalId, 'approve_once');
    expect(response.status).toBe(200);
    await waitForPendingStatus(harness, outcome.approvalId, 'failed');
    expect(await listRoutinesForAi(harness.context.db, aiId)).toHaveLength(0);
  });

  // 15) `approve_always` on `routine.schedule` is refused with 400
  // `always_not_allowed`, and a second request still creates a new card
  // (no standing rule is ever stored).
  it('routine.schedule can never be always-allowed and every request needs a card', async () => {
    const { owner, aiId, groupId, generalTopicId } = await buildToolsHarness();
    await saveTool(aiId, groupId, generalTopicId, owner.id);

    const outcome = await harness.gateway.request({
      aiId,
      groupId,
      topicId: generalTopicId,
      action: 'routine.schedule',
      args: scheduleArgs(),
      requestedBy: 'ai-bot@zilar.localhost',
    });
    if (outcome.status !== 'pending_approval') {
      throw new Error(`expected pending_approval, got ${outcome.status}`);
    }
    const refused = await decide(harness, owner.cookie, outcome.approvalId, 'approve_always');
    expect(refused.status).toBe(400);
    const refusedBody = (await refused.json()) as { error: { code: string } };
    expect(refusedBody.error.code).toBe('always_not_allowed');

    const second = await harness.gateway.request({
      aiId,
      groupId,
      topicId: generalTopicId,
      action: 'routine.schedule',
      args: scheduleArgs(),
      requestedBy: 'ai-bot@zilar.localhost',
    });
    expect(second.status).toBe('pending_approval');
  });

  // 16) In a group, a plain member cannot decide the schedule card (the
  // approvals route answers 404, the action never runs) while an admin can
  // approve it. (The `request_action` trigger gate itself — member cannot
  // ask, admin can — is T-0098 behaviour covered in `agents/gateway.test.ts`.)
  it('a plain group member cannot decide the schedule card but an admin can', async () => {
    const { aiId, groupId, generalTopicId } = await buildToolsHarness();
    const ownerRow = await harness.context.db
      .select({ owner: ais.owner })
      .from(ais)
      .where(eq(ais.id, aiId))
      .limit(1);
    const ownerId = ownerRow[0]?.owner as string;
    const member = await bootstrapUser(
      harness.context,
      harness.app,
      `plain-member-${testCounter}@example.com`,
    );
    const admin = await bootstrapUser(
      harness.context,
      harness.app,
      `group-admin-${testCounter}@example.com`,
    );
    await harness.context.db.insert(groupMembers).values([
      { groupId, userId: member.id, role: 'member' },
      { groupId, userId: admin.id, role: 'admin' },
    ]);
    await saveTool(aiId, groupId, generalTopicId, ownerId);

    const outcome = await harness.gateway.request({
      aiId,
      groupId,
      topicId: generalTopicId,
      action: 'routine.schedule',
      args: scheduleArgs(),
      requestedBy: 'ai-bot@zilar.localhost',
    });
    if (outcome.status !== 'pending_approval') {
      throw new Error(`expected pending_approval, got ${outcome.status}`);
    }

    const memberResponse = await decide(harness, member.cookie, outcome.approvalId, 'approve_once');
    expect(memberResponse.status).toBe(404);
    const memberBody = (await memberResponse.json()) as { error: { code: string } };
    expect(memberBody.error.code).toBe('not_found');

    // The card is still waiting: the member's attempt changed nothing.

    const adminOutcome = await harness.gateway.request({
      aiId,
      groupId,
      topicId: generalTopicId,
      action: 'routine.schedule',
      args: scheduleArgs(),
      requestedBy: 'ai-bot@zilar.localhost',
    });
    if (adminOutcome.status !== 'pending_approval') {
      throw new Error(`expected pending_approval, got ${adminOutcome.status}`);
    }
    const adminResponse = await decide(
      harness,
      admin.cookie,
      adminOutcome.approvalId,
      'approve_once',
    );
    expect(adminResponse.status).toBe(200);
    await waitForPendingStatus(harness, adminOutcome.approvalId, 'executed');
    expect(await listRoutinesForAi(harness.context.db, aiId)).toHaveLength(1);
  });

  // 18) T-0132 `tool.approve_hosts` end to end: request → the card lists
  // the tool's CURRENT hosts read from the DB → approve once → the tool's
  // approved set is exactly those hosts → a later run reaches them.
  it('tool.approve_hosts runs through the approval flow and approves the DB hosts', async () => {
    const { owner, aiId, groupId, generalTopicId } = await buildToolsHarness();
    await saveTool(aiId, groupId, generalTopicId, owner.id);
    const { getTool } = await import('../tools/service');

    const outcome = await harness.gateway.request({
      aiId,
      groupId,
      topicId: generalTopicId,
      action: 'tool.approve_hosts',
      args: { name: 'prices' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    if (outcome.status !== 'pending_approval') {
      throw new Error(`expected pending_approval, got ${outcome.status}`);
    }
    const [approval] = await harness.context.db
      .select()
      .from(approvals)
      .where(eq(approvals.id, outcome.approvalId));
    expect(approval?.summary).toBe('Allow the tool "prices" to contact: api.example.com');
    expect(approval?.details).toContain('api.example.com');
    expect(approval?.topicId).toBe(generalTopicId);

    const response = await decide(harness, owner.cookie, outcome.approvalId, 'approve_once');
    expect(response.status).toBe(200);
    await waitForPendingStatus(harness, outcome.approvalId, 'executed');

    const [approvedRow] = await harness.context.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'tool.hosts_approved'))
      .limit(1);
    expect(approvedRow?.detail).toEqual({ name: 'prices', version: 1, hosts: ['api.example.com'] });
    const detail = await getTool(harness.context.db, approvedRow?.subjectId as string);
    expect(detail?.approvedHosts).toEqual(['api.example.com']);
  });

  // 19) T-0132: a host change between the approve_hosts card and approval
  // fails safe — the gateway reports `failed` and the approved set is
  // untouched.
  it('a hosts change between approve_hosts request and approval fails without approving', async () => {
    const { owner, aiId, groupId, generalTopicId } = await buildToolsHarness();
    await saveTool(aiId, groupId, generalTopicId, owner.id);

    const outcome = await harness.gateway.request({
      aiId,
      groupId,
      topicId: generalTopicId,
      action: 'tool.approve_hosts',
      args: { name: 'prices' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    if (outcome.status !== 'pending_approval') {
      throw new Error(`expected pending_approval, got ${outcome.status}`);
    }
    await saveToolVersion(
      harness.context.db,
      {
        aiId,
        groupId,
        topicId: generalTopicId,
        name: 'prices',
        description: 'Posts the prices',
        source: 'return { text: "BTC 100" };',
        hosts: ['changed.example.com'],
        message: 'New host',
        userId: owner.id,
      },
      new Date(),
    );

    const response = await decide(harness, owner.cookie, outcome.approvalId, 'approve_once');
    expect(response.status).toBe(200);
    await waitForPendingStatus(harness, outcome.approvalId, 'failed');
    const approvedRows = await harness.context.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'tool.hosts_approved'));
    expect(approvedRows).toHaveLength(0);
  });

  // 20) T-0132: `approve_always` on `tool.approve_hosts` is refused with
  // 400 `always_not_allowed`.
  it('tool.approve_hosts can never be always-allowed', async () => {
    const { owner, aiId, groupId, generalTopicId } = await buildToolsHarness();
    await saveTool(aiId, groupId, generalTopicId, owner.id);

    const outcome = await harness.gateway.request({
      aiId,
      groupId,
      topicId: generalTopicId,
      action: 'tool.approve_hosts',
      args: { name: 'prices' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    if (outcome.status !== 'pending_approval') {
      throw new Error(`expected pending_approval, got ${outcome.status}`);
    }
    const refused = await decide(harness, owner.cookie, outcome.approvalId, 'approve_always');
    expect(refused.status).toBe(400);
    const refusedBody = (await refused.json()) as { error: { code: string } };
    expect(refusedBody.error.code).toBe('always_not_allowed');
  });

  // 17) Stopped AI: the gateway denies before `execute`, so the runner is
  // never called and no post goes out.
  it('a stopped AI denies tool.run before the runner is called', async () => {
    const built = await buildToolsHarness();
    await saveTool(built.aiId, built.groupId, built.generalTopicId, built.owner.id);
    let runnerCalls = 0;
    const countingRunner: ToolRunner = () => {
      runnerCalls += 1;
      return fakeRunner({ source: '', input: null, allowedHosts: [] });
    };
    const gateway = createActionGateway({
      db: harness.context.db,
      adapters: buildRegistry(
        buildToolAdapters({
          db: harness.context.db,
          runner: countingRunner,
          now: () => new Date(),
          post: async (post) => {
            built.posts.push(post);
            return true;
          },
        }),
      ),
      audit: harness.audit,
      logger: {
        warn: () => undefined,
        error: () => undefined,
      },
      now: () => new Date(),
    });
    await harness.context.db.update(ais).set({ status: 'stopped' }).where(eq(ais.id, built.aiId));
    const outcome = await gateway.request({
      aiId: built.aiId,
      groupId: built.groupId,
      topicId: built.generalTopicId,
      action: 'tool.run',
      args: { name: 'prices' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    expect(outcome).toEqual({ status: 'denied', reason: 'ai_not_active' });
    expect(runnerCalls).toBe(0);
    expect(built.posts).toHaveLength(0);
  });
});
