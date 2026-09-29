import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestContext, type TestContext } from '../test-support';
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
  user,
} from '../db/schema';
import { decideApproval } from '../approvals/service';
import { type AuditEntry, createAuditRecorder } from '../audit/service';
import { type ActionAnnouncer } from './announce';
import { createActionGateway, type ActionGateway, type ActionGatewayLogger } from './gateway';
import { startRecoveryStuckTimer } from './gateway';
import { buildRegistry, type ActionAdapter, type ActionRegistry } from './registry';

interface AdapterCall {
  ctx: { aiId: string; groupId: string | null; requestId: string };
  args: unknown;
}

interface FakeAdapter {
  name: string;
  tier: 0 | 1 | 2;
  adapter: ActionAdapter<unknown>;
  calls: AdapterCall[];
}

function echoAdapter(tier: 0 | 1 | 2): FakeAdapter {
  const calls: AdapterCall[] = [];
  const adapter: ActionAdapter<unknown> = {
    name: `tier${tier}.echo`,
    tier,
    argsSchema: z.object({ value: z.string() }),
    describe: (args) => ({ summary: `Echo ${(args as { value: string }).value}` }),
    ...(tier === 2
      ? {
          estimateCost: () => ({ currency: 'EUR' as const, amount: 9.5 }),
        }
      : {}),
    execute: async (ctx, args) => {
      calls.push({ ctx, args });
      return { summary: `Echoed: ${(args as { value: string }).value}` };
    },
  };
  return { name: adapter.name, tier, adapter, calls };
}

interface Harness {
  context: TestContext;
  gateway: ActionGateway;
  adapters: FakeAdapter[];
  auditEntries: AuditEntry[];
}

async function seedUser(context: TestContext, email = 'owner@example.com'): Promise<string> {
  void email;
  const id = randomUUID();
  await context.db.insert(user).values({ id, name: 'Owner', email: `${id}@example.com` });
  return id;
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

async function seedGroup(
  context: TestContext,
  ownerId: string,
  aiIds: string[],
): Promise<{ groupId: string }> {
  const groupId = randomUUID();
  const roomLocalpart = `g${randomUUID().replace(/-/g, '').slice(0, 15)}`;
  await context.db.insert(groups).values({
    id: groupId,
    roomLocalpart,
    title: 'Crew',
    createdBy: ownerId,
  });
  await context.db.insert(groupMembers).values({ groupId, userId: ownerId, role: 'owner' });
  for (const aiId of aiIds) {
    await context.db.insert(groupAis).values({ groupId, aiId, addedBy: ownerId });
  }
  return { groupId };
}

async function buildHarness(adapters: FakeAdapter[]): Promise<Harness> {
  const context = await createTestContext();
  const auditEntries: AuditEntry[] = [];
  const audit = createAuditRecorder({ db: context.db });
  const recordedAudit = {
    ...audit,
    record: async (entry: AuditEntry): Promise<void> => {
      auditEntries.push(entry);
      await audit.record(entry);
    },
  };
  const registry: ActionRegistry = buildRegistry(adapters.map((entry) => entry.adapter));
  const logger: ActionGatewayLogger = {
    warn: () => undefined,
    error: () => undefined,
  };
  const gateway = createActionGateway({
    db: context.db,
    adapters: registry,
    audit: recordedAudit,
    logger,
    now: () => new Date(),
  });
  return { context, gateway, adapters, auditEntries };
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

function captureAnnouncer(): { announcer: ActionAnnouncer; calls: AnnouncerCalls } {
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

async function buildHarnessWithAnnouncer(
  adapters: FakeAdapter[],
): Promise<Harness & { announcerCalls: AnnouncerCalls; throwsAnnouncer: ActionAnnouncer }> {
  const context = await createTestContext();
  const auditEntries: AuditEntry[] = [];
  const audit = createAuditRecorder({ db: context.db });
  const recordedAudit = {
    ...audit,
    record: async (entry: AuditEntry): Promise<void> => {
      auditEntries.push(entry);
      await audit.record(entry);
    },
  };
  const registry: ActionRegistry = buildRegistry(adapters.map((entry) => entry.adapter));
  const warnings: Array<{ fields: Record<string, unknown>; message: string }> = [];
  const logger: ActionGatewayLogger = {
    warn: (fields, message) => {
      warnings.push({ fields, message });
    },
    error: () => undefined,
  };
  const { announcer, calls } = captureAnnouncer();
  const throwsAnnouncer: ActionAnnouncer = {
    async approvalRequested() {
      throw new Error('announcer is down');
    },
    async outcome() {
      throw new Error('announcer is down');
    },
  };
  const gateway = createActionGateway({
    db: context.db,
    adapters: registry,
    audit: recordedAudit,
    logger,
    now: () => new Date(),
    announce: announcer,
  });
  return {
    context,
    gateway,
    adapters,
    auditEntries,
    announcerCalls: calls,
    throwsAnnouncer,
  };
}

describe('action gateway', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await buildHarness([echoAdapter(0), echoAdapter(1), echoAdapter(2)]);
  });

  afterEach(async () => {
    await harness.context.close();
  });

  describe('policy', () => {
    it('denies an unknown action with reason unknown_action', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'no.such.action',
        args: { value: 'x' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result).toEqual({ status: 'denied', reason: 'unknown_action' });
    });

    it('denies a stopped AI with reason ai_not_active', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId, { status: 'stopped' });
      const result = await harness.gateway.request({
        aiId,
        action: 'tier0.echo',
        args: { value: 'x' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result).toEqual({ status: 'denied', reason: 'ai_not_active' });
    });

    it('denies a provisioning (disabled) AI with reason ai_not_active', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId, { status: 'disabled' });
      const result = await harness.gateway.request({
        aiId,
        action: 'tier0.echo',
        args: { value: 'x' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result).toEqual({ status: 'denied', reason: 'ai_not_active' });
    });

    it('denies an AI not in the requested group with reason ai_not_in_group', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const { groupId } = await seedGroup(harness.context, ownerId, []);
      const result = await harness.gateway.request({
        aiId,
        groupId,
        action: 'tier0.echo',
        args: { value: 'x' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result).toEqual({ status: 'denied', reason: 'ai_not_in_group' });
    });

    it('denies invalid args with reason invalid_args', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier0.echo',
        args: { value: 42 },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result).toEqual({ status: 'denied', reason: 'invalid_args' });
    });

    it('executes tier 0 at once', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier0.echo',
        args: { value: 'hello' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result).toEqual({ status: 'executed', summary: 'Echoed: hello' });
      expect(harness.adapters[0]?.calls).toHaveLength(1);
      const pending = await harness.context.db.select().from(pendingActions);
      expect(pending).toHaveLength(0);
    });

    it('executes tier 1 at once', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier1.echo',
        args: { value: 'mid' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result).toEqual({ status: 'executed', summary: 'Echoed: mid' });
      expect(harness.adapters[1]?.calls).toHaveLength(1);
    });

    it('tier 2 never executes before approval', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'spicy' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result).toEqual({ status: 'pending_approval', approvalId: expect.any(String) });
      expect(harness.adapters[2]?.calls).toHaveLength(0);
    });
  });

  describe('approval path', () => {
    it('creates an approval card with the adapter-supplied fields and the same hash', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'spicy' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      const [row] = await harness.context.db
        .select()
        .from(approvals)
        .where(eq(approvals.id, result.approvalId));
      expect(row).toBeDefined();
      expect(row?.action).toBe('tier2.echo');
      expect(row?.summary).toBe('Echo spicy');
      expect(row?.argsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row?.worstCaseCurrency).toBe('EUR');
      expect(row?.worstCaseAmount).toBe('9.50');

      const [pending] = await harness.context.db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.approvalId, result.approvalId));
      expect(pending?.args).toEqual({ value: 'spicy' });
      expect(pending?.argsHash).toBe(row?.argsHash);
      expect(pending?.status).toBe('waiting');
    });

    it('executes the stored args on approval even when the caller later mutates them', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const mutableArgs = { value: 'first' };
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: mutableArgs,
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await decideApproval(
        harness.context.db,
        {
          approvalId: result.approvalId,
          userId: ownerId,
          decision: 'approve_once',
        },
        new Date(),
      );
      // Caller mutates their copy of the args after the fact. The gateway
      // stored its own parsed value, so the adapter still sees the
      // original.
      mutableArgs.value = 'second';

      await harness.gateway.onApprovalDecided(result.approvalId);

      const calls = harness.adapters[2]?.calls;
      expect(calls).toHaveLength(1);
      expect(calls?.[0]?.args).toEqual({ value: 'first' });
      const [pending] = await harness.context.db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.approvalId, result.approvalId));
      expect(pending?.status).toBe('executed');
      expect(pending?.resultSummary).toBe('Echoed: first');
    });

    it('cancels on denial and the adapter is never called', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'spicy' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      const updated = await decideApproval(
        harness.context.db,
        {
          approvalId: result.approvalId,
          userId: ownerId,
          decision: 'deny',
        },
        new Date(),
      );
      expect(updated?.status).toBe('denied');

      await harness.gateway.onApprovalDecided(result.approvalId);

      expect(harness.adapters[2]?.calls).toHaveLength(0);
      const [pending] = await harness.context.db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.approvalId, result.approvalId));
      expect(pending?.status).toBe('cancelled');
    });

    it('cancels on expiry and the adapter is never called', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'spicy' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      // Roll the stored expiry into the past so the approval is past-due.
      await harness.context.db
        .update(approvals)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(eq(approvals.id, result.approvalId));

      await harness.gateway.onApprovalDecided(result.approvalId);

      expect(harness.adapters[2]?.calls).toHaveLength(0);
      const [pending] = await harness.context.db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.approvalId, result.approvalId));
      expect(pending?.status).toBe('cancelled');
    });

    it('runs the adapter exactly once for two concurrent onApprovalDecided calls', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'race' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await decideApproval(
        harness.context.db,
        {
          approvalId: result.approvalId,
          userId: ownerId,
          decision: 'approve_once',
        },
        new Date(),
      );
      await Promise.all([
        harness.gateway.onApprovalDecided(result.approvalId),
        harness.gateway.onApprovalDecided(result.approvalId),
      ]);
      expect(harness.adapters[2]?.calls).toHaveLength(1);
    });

    it('cancels when the stored hash no longer matches what the approval was granted for', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'tamper' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await decideApproval(
        harness.context.db,
        {
          approvalId: result.approvalId,
          userId: ownerId,
          decision: 'approve_once',
        },
        new Date(),
      );
      // Tamper with the stored hash on the pending row to simulate a
      // buggy migration or a hand-edited database.
      await harness.context.db
        .update(pendingActions)
        .set({ argsHash: 'a'.repeat(64) })
        .where(eq(pendingActions.approvalId, result.approvalId));

      await harness.gateway.onApprovalDecided(result.approvalId);

      expect(harness.adapters[2]?.calls).toHaveLength(0);
      const [pending] = await harness.context.db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.approvalId, result.approvalId));
      expect(pending?.status).toBe('cancelled');
    });

    it('cancels when the AI was stopped between request and approval', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'kill' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await decideApproval(
        harness.context.db,
        {
          approvalId: result.approvalId,
          userId: ownerId,
          decision: 'approve_once',
        },
        new Date(),
      );
      // Kill switch: stop the AI before the hook fires.
      await harness.context.db.update(ais).set({ status: 'stopped' }).where(eq(ais.id, aiId));

      await harness.gateway.onApprovalDecided(result.approvalId);

      expect(harness.adapters[2]?.calls).toHaveLength(0);
      const [pending] = await harness.context.db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.approvalId, result.approvalId));
      expect(pending?.status).toBe('cancelled');
    });
  });

  describe('adapter errors', () => {
    it('records failed without storing the error text', async () => {
      const context = await createTestContext();
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const calls: AdapterCall[] = [];
      const secretError = new Error('SECRET-DO-NOT-LOG');
      const failing: ActionAdapter<unknown> = {
        name: 'tier0.failing',
        tier: 0,
        argsSchema: z.object({ value: z.string() }),
        describe: () => ({ summary: 'fails' }),
        execute: async (ctx, args) => {
          calls.push({ ctx, args });
          throw secretError;
        },
      };
      const audit = createAuditRecorder({ db: context.db });
      const auditEntries: AuditEntry[] = [];
      const recordedAudit = {
        ...audit,
        record: async (entry: AuditEntry): Promise<void> => {
          auditEntries.push(entry);
          await audit.record(entry);
        },
      };
      const logger: ActionGatewayLogger = {
        warn: () => undefined,
        error: () => undefined,
      };
      const gateway = createActionGateway({
        db: context.db,
        adapters: buildRegistry([failing]),
        audit: recordedAudit,
        logger,
        now: () => new Date(),
      });

      const result = await gateway.request({
        aiId,
        action: 'tier0.failing',
        args: { value: 'boom' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result).toEqual({ status: 'failed' });

      // The secret text never appears anywhere: not in the audit log, not
      // in any pending-action row (there are none for tier 0), not in the
      // return value.
      const auditRows = await context.db.select().from(auditLog);
      const allText = JSON.stringify({ ...auditRows, calls, result, auditEntries });
      expect(allText).not.toContain('SECRET-DO-NOT-LOG');

      const failed = auditEntries.find((entry) => entry.action === 'action.failed');
      expect(failed?.result).toBe('error');

      await context.close();
    });

    it('runs the adapter at most once even if a second approve race lands during execution', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'race-2' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await decideApproval(
        harness.context.db,
        {
          approvalId: result.approvalId,
          userId: ownerId,
          decision: 'approve_once',
        },
        new Date(),
      );
      await Promise.all([
        harness.gateway.onApprovalDecided(result.approvalId),
        harness.gateway.onApprovalDecided(result.approvalId),
        harness.gateway.onApprovalDecided(result.approvalId),
      ]);
      expect(harness.adapters[2]?.calls).toHaveLength(1);
    });
  });

  describe('transaction integrity', () => {
    it('leaves no approval behind when the pending-action transaction fails', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const context = harness.context;
      // Fill the per-AI pending cap (50) so the next `createApproval`
      // call inside the gateway's transaction throws
      // `ApprovalServiceError('pending_limit')`. The transaction wraps
      // both `createApproval` and the pending-action insert, so a throw
      // in either step must leave no row behind.
      for (let index = 0; index < 50; index += 1) {
        await context.db.insert(approvals).values({
          id: randomUUID(),
          aiId,
          action: 'noop',
          summary: 'noop',
          argsHash: 'a'.repeat(64),
          requestedBy: 'noop',
          status: 'pending',
          expiresAt: new Date(Date.now() + 60_000),
        });
      }
      const approvalsBefore = await context.db.select().from(approvals);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'cap' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result).toEqual({ status: 'denied', reason: 'ai_not_active' });
      // The transaction rolled back: no new approval or pending-action
      // row for the tier2.echo request was written.
      const pending = await context.db.select().from(pendingActions);
      expect(pending.filter((row) => row.action === 'tier2.echo')).toHaveLength(0);
      const approvalsAfter = await context.db.select().from(approvals);
      expect(approvalsAfter.length).toBe(approvalsBefore.length);
    });
  });

  describe('recoverStuck', () => {
    it('marks a stuck running row as failed with reason stuck and never re-executes', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'stuck' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      // Move the pending row to `running` and back-date `startedAt`.
      await harness.context.db
        .update(pendingActions)
        .set({ status: 'running', startedAt: new Date(Date.now() - 11 * 60 * 1000) })
        .where(eq(pendingActions.approvalId, result.approvalId));

      await harness.gateway.recoverStuck();

      const [pending] = await harness.context.db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.approvalId, result.approvalId));
      expect(pending?.status).toBe('failed');
      // The adapter was never invoked.
      expect(harness.adapters[2]?.calls).toHaveLength(0);
      const stuckAudit = await harness.context.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'action.failed'));
      expect(stuckAudit.length).toBeGreaterThan(0);
      const last = stuckAudit[stuckAudit.length - 1];
      expect(last?.detail).toEqual({ reason: 'stuck' });
    });

    it('does not treat a long-waiting action that only just started as stuck', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'slow-approval' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await harness.context.db
        .update(pendingActions)
        .set({
          status: 'running',
          createdAt: new Date(Date.now() - 25 * 60 * 1000),
          startedAt: new Date(),
        })
        .where(eq(pendingActions.approvalId, result.approvalId));

      await harness.gateway.recoverStuck();

      const [pending] = await harness.context.db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.approvalId, result.approvalId));
      expect(pending?.status).toBe('running');
    });

    it('leaves a waiting action alone when its approval is still undecided', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'undecided' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }

      await harness.gateway.onApprovalDecided(result.approvalId);

      const [pending] = await harness.context.db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.approvalId, result.approvalId));
      expect(pending?.status).toBe('waiting');
      expect(harness.adapters[2]?.calls).toHaveLength(0);
    });

    it('cancels a waiting row whose approval is past due', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'orphan' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await harness.context.db
        .update(approvals)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(eq(approvals.id, result.approvalId));

      await harness.gateway.recoverStuck();

      const [pending] = await harness.context.db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.approvalId, result.approvalId));
      expect(pending?.status).toBe('cancelled');
    });
  });

  describe('audit entries', () => {
    it('writes the requested and decided audit entries with no args or error text', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const secret = 'super-secret-content';
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: secret },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await decideApproval(
        harness.context.db,
        {
          approvalId: result.approvalId,
          userId: ownerId,
          decision: 'approve_once',
        },
        new Date(),
      );
      await harness.gateway.onApprovalDecided(result.approvalId);

      const rows = await harness.context.db.select().from(auditLog);
      const all = JSON.stringify(rows);
      expect(all).not.toContain(secret);
      const actions = rows.map((row) => row.action);
      expect(actions).toContain('action.requested');
      expect(actions).toContain('action.executed');
      const requested = rows.find((row) => row.action === 'action.requested');
      expect(requested?.subjectId).toBe(result.approvalId);
      expect(requested?.argsHash).toMatch(/^[0-9a-f]{64}$/);
      const executed = rows.find((row) => row.action === 'action.executed');
      expect(executed?.subjectId).not.toBe(result.approvalId);
    });
  });

  describe('production wiring', () => {
    it('denies every action when the registry is empty', async () => {
      const context = await createTestContext();
      const audit = createAuditRecorder({ db: context.db });
      const logger: ActionGatewayLogger = {
        warn: () => undefined,
        error: () => undefined,
      };
      const gateway = createActionGateway({
        db: context.db,
        adapters: {},
        audit,
        logger,
        now: () => new Date(),
      });
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const result = await gateway.request({
        aiId,
        action: 'anything.at_all',
        args: { value: 'x' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result).toEqual({ status: 'denied', reason: 'unknown_action' });
      await context.close();
    });
  });

  describe('recovery timer', () => {
    it('runs recoverStuck on a cadence and stops on close', async () => {
      const recoverCalls: number[] = [];
      const proxy = {
        request: () => Promise.reject(new Error('unused')),
        onApprovalDecided: () => Promise.resolve(),
        recoverStuck: () => {
          recoverCalls.push(Date.now());
          return Promise.resolve();
        },
      };
      const logger: ActionGatewayLogger = {
        warn: () => undefined,
        error: () => undefined,
      };
      const handle = startRecoveryStuckTimer({
        gateway: proxy,
        logger,
        intervalMs: 10,
      });
      // The timer should fire at least once within a short window.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      handle.close();
      // After close(), no more calls.
      const callsAtClose = recoverCalls.length;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(recoverCalls.length).toBe(callsAtClose);
      expect(callsAtClose).toBeGreaterThan(0);
    });
  });

  describe('announcer (T-0092)', () => {
    let harness: Harness & { announcerCalls: AnnouncerCalls; throwsAnnouncer: ActionAnnouncer };

    beforeEach(async () => {
      harness = await buildHarnessWithAnnouncer([echoAdapter(0), echoAdapter(1), echoAdapter(2)]);
    });

    afterEach(async () => {
      await harness.context.close();
    });

    it('calls approvalRequested once after a tier-2 request with the approval id', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'spicy' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      expect(harness.announcerCalls.approvalRequested).toEqual([
        { aiId, groupId: null, approvalId: result.approvalId },
      ]);
      expect(harness.announcerCalls.outcome).toEqual([]);
    });

    it('passes groupId for a tier-2 request raised in a group', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const { groupId } = await seedGroup(harness.context, ownerId, [aiId]);
      const result = await harness.gateway.request({
        aiId,
        groupId,
        action: 'tier2.echo',
        args: { value: 'spicy' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result.status).toBe('pending_approval');
      if (result.status !== 'pending_approval') {
        return;
      }
      expect(harness.announcerCalls.approvalRequested).toEqual([
        { aiId, groupId, approvalId: result.approvalId },
      ]);
    });

    it('does not call the announcer for tier 0 or tier 1 actions', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      await harness.gateway.request({
        aiId,
        action: 'tier0.echo',
        args: { value: 'fast' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      await harness.gateway.request({
        aiId,
        action: 'tier1.echo',
        args: { value: 'mid' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(harness.announcerCalls.approvalRequested).toEqual([]);
      expect(harness.announcerCalls.outcome).toEqual([]);
    });

    it('does not call the announcer when a tier-2 request is denied before approval', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId, { status: 'stopped' });
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'x' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result).toEqual({ status: 'denied', reason: 'ai_not_active' });
      expect(harness.announcerCalls.approvalRequested).toEqual([]);
    });

    it('calls outcome(executed) with the adapter summary after a successful approval', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'yay' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await decideApproval(
        harness.context.db,
        { approvalId: result.approvalId, userId: ownerId, decision: 'approve_once' },
        new Date(),
      );
      await harness.gateway.onApprovalDecided(result.approvalId);
      expect(harness.announcerCalls.outcome).toEqual([
        { aiId, groupId: null, status: 'executed', summary: 'Echoed: yay' },
      ]);
    });

    it('calls outcome(failed) with the fixed text when the adapter throws', async () => {
      const secretError = new Error('SECRET-DO-NOT-ANNOUNCE');
      const failing: ActionAdapter<unknown> = {
        name: 'tier2.fail',
        tier: 2,
        argsSchema: z.object({ value: z.string() }),
        describe: (args) => ({ summary: `Fail ${(args as { value: string }).value}` }),
        execute: () => {
          throw secretError;
        },
      };
      const context = await createTestContext();
      const { announcer, calls } = captureAnnouncer();
      const audit = createAuditRecorder({ db: context.db });
      const recordedAudit = {
        ...audit,
        record: async (entry: AuditEntry) => {
          await audit.record(entry);
        },
      };
      const warnings: Array<{ fields: Record<string, unknown>; message: string }> = [];
      const logger: ActionGatewayLogger = {
        warn: (fields, message) => {
          warnings.push({ fields, message });
        },
        error: () => undefined,
      };
      const gateway = createActionGateway({
        db: context.db,
        adapters: buildRegistry([failing]),
        audit: recordedAudit,
        logger,
        now: () => new Date(),
        announce: announcer,
      });
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const result = await gateway.request({
        aiId,
        action: 'tier2.fail',
        args: { value: 'x' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await decideApproval(
        context.db,
        { approvalId: result.approvalId, userId: ownerId, decision: 'approve_once' },
        new Date(),
      );
      await gateway.onApprovalDecided(result.approvalId);
      expect(calls.outcome).toEqual([
        { aiId, groupId: null, status: 'failed', summary: 'The action failed.' },
      ]);
      // The adapter's error text never leaks through the announcer summary.
      expect(JSON.stringify(calls)).not.toContain('SECRET-DO-NOT-ANNOUNCE');
      // The audit log has the failure recorded without leaking the error text.
      const rows = await context.db.select().from(auditLog);
      expect(JSON.stringify(rows)).not.toContain('SECRET-DO-NOT-ANNOUNCE');
      await context.close();
    });

    it('calls outcome(cancelled) for denial, expiry, and stopped-AI paths', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);

      // 1) denial
      const r1 = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'a' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (r1.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await decideApproval(
        harness.context.db,
        { approvalId: r1.approvalId, userId: ownerId, decision: 'deny' },
        new Date(),
      );
      await harness.gateway.onApprovalDecided(r1.approvalId);

      // 2) expiry
      const r2 = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'b' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (r2.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await harness.context.db
        .update(approvals)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(eq(approvals.id, r2.approvalId));
      await harness.gateway.onApprovalDecided(r2.approvalId);

      // 3) stopped AI
      const r3 = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'c' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (r3.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await decideApproval(
        harness.context.db,
        { approvalId: r3.approvalId, userId: ownerId, decision: 'approve_once' },
        new Date(),
      );
      await harness.context.db.update(ais).set({ status: 'stopped' }).where(eq(ais.id, aiId));
      await harness.gateway.onApprovalDecided(r3.approvalId);

      expect(harness.announcerCalls.outcome).toEqual([
        { aiId, groupId: null, status: 'cancelled', summary: 'The request was not carried out.' },
        { aiId, groupId: null, status: 'cancelled', summary: 'The request was not carried out.' },
        { aiId, groupId: null, status: 'cancelled', summary: 'The request was not carried out.' },
      ]);
    });

    it('a throwing announcer does not change the outcome, the rows, or the audit', async () => {
      const context = await createTestContext();
      const auditEntries: AuditEntry[] = [];
      const audit = createAuditRecorder({ db: context.db });
      const recordedAudit = {
        ...audit,
        record: async (entry: AuditEntry) => {
          auditEntries.push(entry);
          await audit.record(entry);
        },
      };
      const warnings: Array<{ fields: Record<string, unknown>; message: string }> = [];
      const logger: ActionGatewayLogger = {
        warn: (fields, message) => {
          warnings.push({ fields, message });
        },
        error: () => undefined,
      };
      const failing: ActionAdapter<unknown> = {
        name: 'tier2.boom',
        tier: 2,
        argsSchema: z.object({ value: z.string() }),
        describe: (args) => ({ summary: `Boom ${(args as { value: string }).value}` }),
        execute: () => {
          throw new Error('adapter secret text');
        },
      };
      const gateway = createActionGateway({
        db: context.db,
        adapters: buildRegistry([failing]),
        audit: recordedAudit,
        logger,
        now: () => new Date(),
        announce: harness.throwsAnnouncer,
      });
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const result = await gateway.request({
        aiId,
        action: 'tier2.boom',
        args: { value: 'spicy' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await decideApproval(
        context.db,
        { approvalId: result.approvalId, userId: ownerId, decision: 'approve_once' },
        new Date(),
      );
      await gateway.onApprovalDecided(result.approvalId);

      // Outcome unchanged: adapter threw → failed.
      const [pending] = await context.db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.approvalId, result.approvalId));
      expect(pending?.status).toBe('failed');
      // Audit entries still got written.
      const actions = auditEntries.map((entry) => entry.action);
      expect(actions).toContain('action.requested');
      expect(actions).toContain('action.failed');
      // The announcer's throw was logged with the error class name only.
      const announcerWarnings = warnings.filter((entry) =>
        entry.message.startsWith('announcer failed for'),
      );
      expect(announcerWarnings.length).toBeGreaterThan(0);
      for (const warning of announcerWarnings) {
        const err = warning.fields['err'];
        expect(err).toBe('Error');
      }
      // No adapter error text in the warnings.
      const warningText = JSON.stringify(warnings);
      expect(warningText).not.toContain('adapter secret text');
      await context.close();
    });

    it('no announcer means no error: the request still resolves', async () => {
      // The default `buildHarness` builds a gateway without an announcer.
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'silent' },
        requestedBy: 'ai-bot@galena.localhost',
      });
      expect(result.status).toBe('pending_approval');
    });
  });
});
