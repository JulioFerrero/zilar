import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../app';
import { createAuditRecorder, type AuditEntry, type AuditRecorder } from '../audit/service';
import {
  aiLimits,
  ais,
  approvals,
  auditLog,
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
import { type ActionAdapter, type ActionRegistry, buildRegistry } from './registry';
import {
  createActionGateway,
  type ActionAnnouncer,
  type ActionGateway,
  type ActionGatewayLogger,
} from './gateway';

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
    argsSchema: z.object({ value: z.string().min(1).max(64) }),
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
    argsSchema: z.object({ value: z.string().min(1).max(64) }),
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
  const jid = `${localpart}@galena.localhost`;
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
    requestedBy: 'ai-bot@galena.localhost',
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
  decision: 'approve_once' | 'deny',
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
      requestedBy: 'ai-bot@galena.localhost',
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
      requestedBy: 'ai-bot@galena.localhost',
    });
    expect(unknown).toEqual({ status: 'denied', reason: 'unknown_action' });

    const invalid = await harness.gateway.request({
      aiId,
      action: 'flow.tier2',
      args: { value: 42 },
      requestedBy: 'ai-bot@galena.localhost',
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
});
