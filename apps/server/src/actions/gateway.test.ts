import { randomUUID } from 'node:crypto';
import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { decideApproval } from '../approvals/service';
import { createRule } from '../approvals/rules';
import { type AuditEntry, createAuditRecorder } from '../audit/service';
import { type ActionAnnouncer } from './announce';
import { createActionGateway, type ActionGateway, type ActionGatewayLogger } from './gateway';
import { startRecoveryStuckTimer } from './gateway';
import { buildRegistry, type ActionAdapter, type ActionRegistry } from './registry';

interface ApprovalRow {
  action: string;
  summary: string;
  argsHash: string;
  worstCaseCurrency: string | null;
  worstCaseAmount: string | null;
}

interface PendingRow {
  args: unknown;
  argsHash: string;
  status: string;
  resultSummary: string | null;
}

interface AuditRow {
  action: string;
  aiId: string | null;
  groupId: string | null;
  subjectId: string | null;
  argsHash: string | null;
}

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
    description: `Echo adapter at tier ${tier}.`,
    tier,
    argsSchema: Schema.Struct({ value: Schema.String }),
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
  const address = `${id}@example.com`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO "user" (id, name, email) VALUES (${id}, 'Owner', ${address})`;
    }),
  );
  return id;
}

async function seedAi(
  context: TestContext,
  ownerId: string,
  overrides: { status?: 'active' | 'disabled' | 'stopped' } = {},
): Promise<{ aiId: string }> {
  const connectionId = randomUUID();
  const aiId = randomUUID();
  const localpart = `ai-${aiId}`;
  const jid = `${localpart}@zilar.localhost`;
  const status = overrides.status ?? 'active';
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label) VALUES (${connectionId}, ${ownerId}, 'openai', 'sealed-placeholder', NULL)`;
      yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status) VALUES (${aiId}, ${ownerId}, 'Helper', 'dev', 'A persona', ${connectionId}, 'gpt-4o-mini', ${localpart}, ${jid}, ${status})`;
      yield* sql`INSERT INTO ai_limits (ai_id, per_day_usd, per_month_usd) VALUES (${aiId}, '1.00', '20.00')`;
    }),
  );
  return { aiId };
}

async function seedGroup(
  context: TestContext,
  ownerId: string,
  aiIds: string[],
): Promise<{ groupId: string; generalTopicId: string }> {
  const groupId = randomUUID();
  const roomLocalpart = `g${randomUUID().replace(/-/g, '').slice(0, 15)}`;
  const generalTopicId = randomUUID();
  const generalRoomLocalpart = `g${randomUUID().replace(/-/g, '').slice(0, 15)}`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO groups (id, room_localpart, title, created_by) VALUES (${groupId}, ${roomLocalpart}, 'Crew', ${ownerId})`;
      yield* sql`INSERT INTO group_members (group_id, user_id, role) VALUES (${groupId}, ${ownerId}, 'owner')`;
      for (const aiId of aiIds) {
        yield* sql`INSERT INTO group_ais (group_id, ai_id, added_by) VALUES (${groupId}, ${aiId}, ${ownerId})`;
      }
      yield* sql`INSERT INTO topics (id, group_id, name, glyph, room_localpart, visibility, kind, status, is_general, created_by) VALUES (${generalTopicId}, ${groupId}, 'General', 'G', ${generalRoomLocalpart}, 'public', 'chat', 'open', true, ${ownerId})`;
    }),
  );
  return { groupId, generalTopicId };
}

async function seedTopic(
  context: TestContext,
  groupId: string,
  creatorId: string,
  name: string,
): Promise<string> {
  const topicId = randomUUID();
  const roomLocalpart = `g${randomUUID().replace(/-/g, '').slice(0, 15)}`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topics (id, group_id, name, glyph, room_localpart, visibility, kind, status, is_general, created_by) VALUES (${topicId}, ${groupId}, ${name}, 'T', ${roomLocalpart}, 'public', 'chat', 'open', false, ${creatorId})`;
    }),
  );
  return topicId;
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(result).toEqual({ status: 'denied', reason: 'ai_not_active' });
    });

    it('denies an AI not in the requested group with reason ai_not_in_group', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(harness.context, ownerId, []);
      const result = await harness.gateway.request({
        aiId,
        groupId,
        topicId: generalTopicId,
        action: 'tier0.echo',
        args: { value: 'x' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(result).toEqual({ status: 'denied', reason: 'ai_not_in_group' });
    });

    it('denies a group request without a topic, and a topic of another group', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const first = await seedGroup(harness.context, ownerId, [aiId]);
      const second = await seedGroup(harness.context, ownerId, [aiId]);
      // No topic: denied even though the AI is in the group.
      const missing = await harness.gateway.request({
        aiId,
        groupId: first.groupId,
        action: 'tier0.echo',
        args: { value: 'x' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(missing).toEqual({ status: 'denied', reason: 'ai_not_in_group' });
      // A topic of another group: denied.
      const foreign = await harness.gateway.request({
        aiId,
        groupId: first.groupId,
        topicId: second.generalTopicId,
        action: 'tier0.echo',
        args: { value: 'x' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(foreign).toEqual({ status: 'denied', reason: 'ai_not_in_group' });
      // A non-General topic the AI was never added to: denied.
      const other = await seedTopic(harness.context, first.groupId, ownerId, 'Other');
      const unjoined = await harness.gateway.request({
        aiId,
        groupId: first.groupId,
        topicId: other,
        action: 'tier0.echo',
        args: { value: 'x' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(unjoined).toEqual({ status: 'denied', reason: 'ai_not_in_group' });
      // An archived topic: denied, the room is gone.
      await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE topics SET archived_at = now() WHERE id = ${first.generalTopicId}`;
        }),
      );
      const archived = await harness.gateway.request({
        aiId,
        groupId: first.groupId,
        topicId: first.generalTopicId,
        action: 'tier0.echo',
        args: { value: 'x' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(archived).toEqual({ status: 'denied', reason: 'ai_not_in_group' });
    });

    it('denies invalid args with reason invalid_args', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier0.echo',
        args: { value: 42 },
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(result).toEqual({ status: 'executed', summary: 'Echoed: hello' });
      expect(harness.adapters[0]?.calls).toHaveLength(1);
      const pending = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ id: string }>`SELECT id FROM pending_actions`;
        }),
      );
      expect(pending).toHaveLength(0);
    });

    it('executes tier 1 at once', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier1.echo',
        args: { value: 'mid' },
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      const [row] = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<ApprovalRow>`SELECT action, summary, args_hash, worst_case_currency, worst_case_amount FROM approvals WHERE id = ${result.approvalId}`;
        }),
      );
      expect(row).toBeDefined();
      expect(row?.action).toBe('tier2.echo');
      expect(row?.summary).toBe('Echo spicy');
      expect(row?.argsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row?.worstCaseCurrency).toBe('EUR');
      expect(row?.worstCaseAmount).toBe('9.50');

      const [pending] = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<PendingRow>`SELECT args, args_hash, status, result_summary FROM pending_actions WHERE approval_id = ${result.approvalId}`;
        }),
      );
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
        requestedBy: 'ai-bot@zilar.localhost',
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
      const [pending] = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<PendingRow>`SELECT args, args_hash, status, result_summary FROM pending_actions WHERE approval_id = ${result.approvalId}`;
        }),
      );
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
        requestedBy: 'ai-bot@zilar.localhost',
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
      expect(updated?.row.status).toBe('denied');

      await harness.gateway.onApprovalDecided(result.approvalId);

      expect(harness.adapters[2]?.calls).toHaveLength(0);
      const [pending] = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<PendingRow>`SELECT args, args_hash, status, result_summary FROM pending_actions WHERE approval_id = ${result.approvalId}`;
        }),
      );
      expect(pending?.status).toBe('cancelled');
    });

    it('cancels on expiry and the adapter is never called', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'spicy' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      // Roll the stored expiry into the past so the approval is past-due.
      const expiredAt = new Date(Date.now() - 1).toISOString();
      await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE approvals SET expires_at = ${expiredAt}::timestamptz WHERE id = ${result.approvalId}`;
        }),
      );

      await harness.gateway.onApprovalDecided(result.approvalId);

      expect(harness.adapters[2]?.calls).toHaveLength(0);
      const [pending] = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<PendingRow>`SELECT args, args_hash, status, result_summary FROM pending_actions WHERE approval_id = ${result.approvalId}`;
        }),
      );
      expect(pending?.status).toBe('cancelled');
    });

    it('runs the adapter exactly once for two concurrent onApprovalDecided calls', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'race' },
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
      await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE pending_actions SET args_hash = ${'a'.repeat(64)} WHERE approval_id = ${result.approvalId}`;
        }),
      );

      await harness.gateway.onApprovalDecided(result.approvalId);

      expect(harness.adapters[2]?.calls).toHaveLength(0);
      const [pending] = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<PendingRow>`SELECT args, args_hash, status, result_summary FROM pending_actions WHERE approval_id = ${result.approvalId}`;
        }),
      );
      expect(pending?.status).toBe('cancelled');
    });

    it('cancels when the AI was stopped between request and approval', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'kill' },
        requestedBy: 'ai-bot@zilar.localhost',
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
      await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE ais SET status = 'stopped' WHERE id = ${aiId}`;
        }),
      );

      await harness.gateway.onApprovalDecided(result.approvalId);

      expect(harness.adapters[2]?.calls).toHaveLength(0);
      const [pending] = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<PendingRow>`SELECT args, args_hash, status, result_summary FROM pending_actions WHERE approval_id = ${result.approvalId}`;
        }),
      );
      expect(pending?.status).toBe('cancelled');
    });

    // T-0132 `prepareArgs`: an adapter binds server-side state into the
    // stored args before the hash is computed, so the card and the hash
    // carry the bound value, not the raw model text.
    it('prepareArgs binds server state into the stored args and hash before the card', async () => {
      const boundAdapter: ActionAdapter<unknown> = {
        name: 'tier2.bound',
        description: 'Tier-2 adapter with prepareArgs.',
        tier: 2,
        argsSchema: Schema.Struct({ value: Schema.String }),
        prepareArgs: async (_ctx, args) => ({ ...(args as { value: string }), bound: true }),
        describe: (args) => ({
          summary: `Bound ${(args as { value: string }).value}`,
          details: `bound=${String((args as { bound?: boolean }).bound)}`,
        }),
        execute: async () => ({ summary: 'bound ran' }),
      };
      const context = await createTestContext();
      try {
        const gateway = createActionGateway({
          db: context.db,
          adapters: buildRegistry([boundAdapter]),
          audit: createAuditRecorder({ db: context.db }),
          logger: { warn: () => undefined, error: () => undefined },
          now: () => new Date(),
        });
        const ownerId = await seedUser(context);
        const { aiId } = await seedAi(context, ownerId);
        const result = await gateway.request({
          aiId,
          action: 'tier2.bound',
          args: { value: 'raw' },
          requestedBy: 'ai-bot@zilar.localhost',
        });
        if (result.status !== 'pending_approval') {
          throw new Error('expected pending_approval');
        }
        const [row] = await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{
              summary: string;
              details: string | null;
              argsHash: string;
            }>`SELECT summary, details, args_hash FROM approvals WHERE id = ${result.approvalId}`;
          }),
        );
        expect(row?.summary).toBe('Bound raw');
        expect(row?.details).toBe('bound=true');
        const [pending] = await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<PendingRow>`SELECT args, args_hash, status, result_summary FROM pending_actions WHERE approval_id = ${result.approvalId}`;
          }),
        );
        expect(pending?.args).toEqual({ value: 'raw', bound: true });
        expect(pending?.argsHash).toBe(row?.argsHash);
      } finally {
        await context.close();
      }
    });

    // A throwing `prepareArgs` (e.g. a missing tool) answers the generic
    // `failed`, never a leak and never `denied`.
    it('a throwing prepareArgs answers failed without storing anything', async () => {
      const failingAdapter: ActionAdapter<unknown> = {
        name: 'tier2.failingprepare',
        description: 'Tier-2 adapter whose prepareArgs throws.',
        tier: 2,
        argsSchema: Schema.Struct({ value: Schema.String }),
        prepareArgs: () => {
          throw new Error('no such tool');
        },
        describe: () => ({ summary: 'never described' }),
        execute: async () => ({ summary: 'never executed' }),
      };
      const context = await createTestContext();
      try {
        const gateway = createActionGateway({
          db: context.db,
          adapters: buildRegistry([failingAdapter]),
          audit: createAuditRecorder({ db: context.db }),
          logger: { warn: () => undefined, error: () => undefined },
          now: () => new Date(),
        });
        const ownerId = await seedUser(context);
        const { aiId } = await seedAi(context, ownerId);
        const result = await gateway.request({
          aiId,
          action: 'tier2.failingprepare',
          args: { value: 'raw' },
          requestedBy: 'ai-bot@zilar.localhost',
        });
        expect(result).toEqual({ status: 'failed' });
        const approvalRows = await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ id: string }>`SELECT id FROM approvals`;
          }),
        );
        expect(approvalRows).toHaveLength(0);
        const pendingRows = await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ id: string }>`SELECT id FROM pending_actions`;
          }),
        );
        expect(pendingRows).toHaveLength(0);
      } finally {
        await context.close();
      }
    });
  });

  describe('modelText (T-0105)', () => {
    function modelTextAdapter(): ActionAdapter<unknown> {
      return {
        name: 'tier0.withtext',
        description: 'Tier-0 adapter that returns modelText.',
        tier: 0,
        argsSchema: Schema.Struct({ value: Schema.String }),
        describe: () => ({ summary: 'withtext' }),
        execute: async () => ({
          summary: 'withtext ran',
          modelText: 'SECRET-TOOL-OUTPUT-DO-NOT-AUDIT',
        }),
      };
    }

    async function buildHarnessWith(adapter: ActionAdapter<unknown>): Promise<{
      context: TestContext;
      gateway: ActionGateway;
      auditEntries: AuditEntry[];
      announcerCalls: AnnouncerCalls;
    }> {
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
      const { announcer, calls } = captureAnnouncer();
      const gateway = createActionGateway({
        db: context.db,
        adapters: buildRegistry([adapter]),
        audit: recordedAudit,
        logger: {
          warn: () => undefined,
          error: () => undefined,
        },
        now: () => new Date(),
        announce: announcer,
      });
      return { context, gateway, auditEntries, announcerCalls: calls };
    }

    it('reaches the outcome but never the pending row, audit or announcer', async () => {
      const built = await buildHarnessWith(modelTextAdapter());
      const ownerId = await seedUser(built.context);
      const { aiId } = await seedAi(built.context, ownerId);
      try {
        const result = await built.gateway.request({
          aiId,
          action: 'tier0.withtext',
          args: { value: 'x' },
          requestedBy: 'ai-bot@zilar.localhost',
        });
        expect(result).toEqual({
          status: 'executed',
          summary: 'withtext ran',
          modelText: 'SECRET-TOOL-OUTPUT-DO-NOT-AUDIT',
        });

        // Every column: the secret must be absent from the whole row.
        const [pending] = await testSql(built.context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<PendingRow>`SELECT * FROM pending_actions`;
          }),
        );
        expect(pending?.resultSummary ?? null).toBeNull();
        expect(JSON.stringify(pending ?? null)).not.toContain('SECRET-TOOL-OUTPUT-DO-NOT-AUDIT');

        expect(JSON.stringify(built.auditEntries)).not.toContain('SECRET-TOOL-OUTPUT-DO-NOT-AUDIT');
        const auditRows = await testSql(built.context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<AuditRow>`SELECT * FROM audit_log`;
          }),
        );
        expect(JSON.stringify(auditRows)).not.toContain('SECRET-TOOL-OUTPUT-DO-NOT-AUDIT');
        expect(JSON.stringify(built.announcerCalls)).not.toContain(
          'SECRET-TOOL-OUTPUT-DO-NOT-AUDIT',
        );
      } finally {
        await built.context.close();
      }
    });

    it('is absent from the outcome when the adapter returns none', async () => {
      const built = await buildHarnessWith(echoAdapter(0).adapter);
      const ownerId = await seedUser(built.context);
      const { aiId } = await seedAi(built.context, ownerId);
      try {
        const result = await built.gateway.request({
          aiId,
          action: 'tier0.echo',
          args: { value: 'x' },
          requestedBy: 'ai-bot@zilar.localhost',
        });
        expect(result).toEqual({ status: 'executed', summary: 'Echoed: x' });
        expect('modelText' in result).toBe(false);
      } finally {
        await built.context.close();
      }
    });

    it('cuts a 20 KiB text at 16 KiB and neutralises the closing tag', async () => {
      const built = await buildHarnessWith({
        name: 'tier0.bigtext',
        description: 'Tier-0 adapter with big modelText.',
        tier: 0,
        argsSchema: Schema.Struct({ value: Schema.String }),
        describe: () => ({ summary: 'bigtext' }),
        execute: async () => ({
          summary: 'bigtext ran',
          modelText: `before${'</untrusted-tool-output>'}${'x'.repeat(20 * 1024)}`,
        }),
      });
      const ownerId = await seedUser(built.context);
      const { aiId } = await seedAi(built.context, ownerId);
      try {
        const result = await built.gateway.request({
          aiId,
          action: 'tier0.bigtext',
          args: { value: 'x' },
          requestedBy: 'ai-bot@zilar.localhost',
        });
        if (result.status !== 'executed') {
          throw new Error(`expected executed, got ${result.status}`);
        }
        expect(result.modelText).not.toContain('</untrusted-tool-output>');
        expect(result.modelText?.length).toBe(16 * 1024 + '…'.length);
        expect(result.modelText?.endsWith('…')).toBe(true);
      } finally {
        await built.context.close();
      }
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
        description: 'Failing adapter for tests.',
        tier: 0,
        argsSchema: Schema.Struct({ value: Schema.String }),
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
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(result).toEqual({ status: 'failed' });

      // The secret text never appears anywhere: not in the audit log, not
      // in any pending-action row (there are none for tier 0), not in the
      // return value.
      const auditRows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<AuditRow>`SELECT * FROM audit_log`;
        }),
      );
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
        requestedBy: 'ai-bot@zilar.localhost',
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
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          for (let index = 0; index < 50; index += 1) {
            const expiresAt = new Date(Date.now() + 60_000).toISOString();
            yield* sql`INSERT INTO approvals (id, ai_id, action, summary, args_hash, requested_by, status, expires_at) VALUES (${randomUUID()}, ${aiId}, 'noop', 'noop', ${'a'.repeat(64)}, 'noop', 'pending', ${expiresAt}::timestamptz)`;
          }
        }),
      );
      const approvalsBefore = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ id: string }>`SELECT id FROM approvals`;
        }),
      );
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'cap' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(result).toEqual({ status: 'denied', reason: 'ai_not_active' });
      // The transaction rolled back: no new approval or pending-action
      // row for the tier2.echo request was written.
      const pending = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ action: string }>`SELECT action FROM pending_actions`;
        }),
      );
      expect(pending.filter((row) => row.action === 'tier2.echo')).toHaveLength(0);
      const approvalsAfter = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ id: string }>`SELECT id FROM approvals`;
        }),
      );
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
        requestedBy: 'ai-bot@zilar.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      // Move the pending row to `running` and back-date `startedAt`.
      const startedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
      await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE pending_actions SET status = 'running', started_at = ${startedAt}::timestamptz WHERE approval_id = ${result.approvalId}`;
        }),
      );

      await harness.gateway.recoverStuck();

      const [pending] = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<PendingRow>`SELECT args, args_hash, status, result_summary FROM pending_actions WHERE approval_id = ${result.approvalId}`;
        }),
      );
      expect(pending?.status).toBe('failed');
      // The adapter was never invoked.
      expect(harness.adapters[2]?.calls).toHaveLength(0);
      const stuckAudit = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            detail: unknown;
          }>`SELECT detail FROM audit_log WHERE action = 'action.failed'`;
        }),
      );
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
        requestedBy: 'ai-bot@zilar.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      const createdAt = new Date(Date.now() - 25 * 60 * 1000).toISOString();
      const startedAt = new Date().toISOString();
      await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE pending_actions SET status = 'running', created_at = ${createdAt}::timestamptz, started_at = ${startedAt}::timestamptz WHERE approval_id = ${result.approvalId}`;
        }),
      );

      await harness.gateway.recoverStuck();

      const [pending] = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<PendingRow>`SELECT args, args_hash, status, result_summary FROM pending_actions WHERE approval_id = ${result.approvalId}`;
        }),
      );
      expect(pending?.status).toBe('running');
    });

    it('leaves a waiting action alone when its approval is still undecided', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const result = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'undecided' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }

      await harness.gateway.onApprovalDecided(result.approvalId);

      const [pending] = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<PendingRow>`SELECT args, args_hash, status, result_summary FROM pending_actions WHERE approval_id = ${result.approvalId}`;
        }),
      );
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
        requestedBy: 'ai-bot@zilar.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      const expiredAt = new Date(Date.now() - 1).toISOString();
      await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE approvals SET expires_at = ${expiredAt}::timestamptz WHERE id = ${result.approvalId}`;
        }),
      );

      await harness.gateway.recoverStuck();

      const [pending] = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<PendingRow>`SELECT args, args_hash, status, result_summary FROM pending_actions WHERE approval_id = ${result.approvalId}`;
        }),
      );
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
        requestedBy: 'ai-bot@zilar.localhost',
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

      // Every column: the secret must be absent from the whole row.
      const rows = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<AuditRow>`SELECT * FROM audit_log`;
        }),
      );
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
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(result).toEqual({ status: 'denied', reason: 'unknown_action' });
      await context.close();
    });
  });

  describe('listActions', () => {
    it('returns every registered action with its description, sorted by name', () => {
      expect(harness.gateway.listActions()).toEqual([
        { name: 'tier0.echo', description: 'Echo adapter at tier 0.' },
        { name: 'tier1.echo', description: 'Echo adapter at tier 1.' },
        { name: 'tier2.echo', description: 'Echo adapter at tier 2.' },
      ]);
    });

    it('returns an empty list when no action is registered', async () => {
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
      expect(gateway.listActions()).toEqual([]);
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
        listActions: () => [],
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
        requestedBy: 'ai-bot@zilar.localhost',
      });
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      expect(harness.announcerCalls.approvalRequested).toEqual([
        { aiId, groupId: null, approvalId: result.approvalId },
      ]);
      expect(harness.announcerCalls.outcome).toEqual([]);
    });

    it('passes groupId and topicId for a tier-2 request raised in a topic', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(harness.context, ownerId, [aiId]);
      const result = await harness.gateway.request({
        aiId,
        groupId,
        topicId: generalTopicId,
        action: 'tier2.echo',
        args: { value: 'spicy' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(result.status).toBe('pending_approval');
      if (result.status !== 'pending_approval') {
        return;
      }
      expect(harness.announcerCalls.approvalRequested).toEqual([
        { aiId, groupId, topicId: generalTopicId, approvalId: result.approvalId },
      ]);
      // The stored rows carry the topic.
      const [approval] = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            topicId: string | null;
          }>`SELECT topic_id FROM approvals WHERE id = ${result.approvalId}`;
        }),
      );
      expect(approval?.topicId).toBe(generalTopicId);
      const [pending] = await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            topicId: string | null;
          }>`SELECT topic_id FROM pending_actions WHERE approval_id = ${result.approvalId}`;
        }),
      );
      expect(pending?.topicId).toBe(generalTopicId);
    });

    it('does not call the announcer for tier 0 or tier 1 actions', async () => {
      const ownerId = await seedUser(harness.context);
      const { aiId } = await seedAi(harness.context, ownerId);
      await harness.gateway.request({
        aiId,
        action: 'tier0.echo',
        args: { value: 'fast' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      await harness.gateway.request({
        aiId,
        action: 'tier1.echo',
        args: { value: 'mid' },
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        description: 'Always fails (test)',
        tier: 2,
        argsSchema: Schema.Struct({ value: Schema.String }),
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
        requestedBy: 'ai-bot@zilar.localhost',
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
      const rows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<AuditRow>`SELECT * FROM audit_log`;
        }),
      );
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
        requestedBy: 'ai-bot@zilar.localhost',
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
        requestedBy: 'ai-bot@zilar.localhost',
      });
      if (r2.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      const expiredAt = new Date(Date.now() - 1).toISOString();
      await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE approvals SET expires_at = ${expiredAt}::timestamptz WHERE id = ${r2.approvalId}`;
        }),
      );
      await harness.gateway.onApprovalDecided(r2.approvalId);

      // 3) stopped AI
      const r3 = await harness.gateway.request({
        aiId,
        action: 'tier2.echo',
        args: { value: 'c' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      if (r3.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await decideApproval(
        harness.context.db,
        { approvalId: r3.approvalId, userId: ownerId, decision: 'approve_once' },
        new Date(),
      );
      await testSql(harness.context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE ais SET status = 'stopped' WHERE id = ${aiId}`;
        }),
      );
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
        description: 'Always throws (test)',
        tier: 2,
        argsSchema: Schema.Struct({ value: Schema.String }),
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
        requestedBy: 'ai-bot@zilar.localhost',
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
      const [pending] = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<PendingRow>`SELECT args, args_hash, status, result_summary FROM pending_actions WHERE approval_id = ${result.approvalId}`;
        }),
      );
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
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(result.status).toBe('pending_approval');
    });
  });

  describe('standing rules (T-0099)', () => {
    const ruleNow = new Date('2026-01-01T00:00:00Z');

    function eligibleAdapter(): FakeAdapter {
      const calls: AdapterCall[] = [];
      const adapter: ActionAdapter<unknown> = {
        name: 'rules.echo',
        description: 'Opted-in echo adapter for standing-rule tests.',
        tier: 2,
        argsSchema: Schema.Struct({ value: Schema.String }),
        describe: (args) => ({ summary: `Echo ${(args as { value: string }).value}` }),
        allowAlways: true,
        execute: async (ctx, args) => {
          calls.push({ ctx, args });
          return { summary: `Echoed: ${(args as { value: string }).value}` };
        },
      };
      return { name: adapter.name, tier: 2 as const, adapter, calls };
    }

    async function buildRuledHarness() {
      const picked = eligibleAdapter();
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
      const registry: ActionRegistry = buildRegistry([picked.adapter]);
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
      return { context, gateway, picked, auditEntries };
    }

    it('executes at once with no approval row and the prefixed announcer notice', async () => {
      const ruled = await buildRuledHarness();
      const { announcer, calls } = captureAnnouncer();
      const gatewayWithAnnounce = createActionGateway({
        db: ruled.context.db,
        adapters: buildRegistry([ruled.picked.adapter]),
        audit: createAuditRecorder({ db: ruled.context.db }),
        logger: { warn: () => undefined, error: () => undefined },
        now: () => new Date(),
        announce: announcer,
      });
      try {
        const ownerId = await seedUser(ruled.context);
        const { aiId } = await seedAi(ruled.context, ownerId);
        const { rule } = await createRule(
          ruled.context.db,
          { aiId, groupId: null, topicId: null, action: 'rules.echo', createdBy: ownerId },
          ruleNow,
        );
        const approvalsBefore = await testSql(ruled.context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ id: string }>`SELECT id FROM approvals`;
          }),
        );
        const outcome = await gatewayWithAnnounce.request({
          aiId,
          action: 'rules.echo',
          args: { value: 'fast' },
          requestedBy: 'ai-bot@zilar.localhost',
        });
        expect(outcome).toEqual({ status: 'executed', summary: 'Echoed: fast' });
        const approvalsAfter = await testSql(ruled.context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ id: string }>`SELECT id FROM approvals`;
          }),
        );
        expect(approvalsAfter).toHaveLength(approvalsBefore.length);
        expect(ruled.picked.calls).toHaveLength(1);
        expect(calls.approvalRequested).toHaveLength(0);
        expect(calls.outcome).toEqual([
          {
            aiId,
            groupId: null,
            status: 'executed',
            summary: 'Ran automatically (always allowed in this chat): Echoed: fast',
          },
        ]);
        // Every column: the args text must be absent from the whole row.
        const auditRows = await testSql(ruled.context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<AuditRow>`SELECT * FROM audit_log`;
          }),
        );
        const auto = auditRows.find((row) => row.action === 'action.auto_approved');
        expect(auto).toMatchObject({ subjectId: rule.id, aiId, groupId: null });
        expect(auto?.argsHash).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(auditRows)).not.toContain('fast');
      } finally {
        await ruled.context.close();
      }
    });

    it('a failed adapter answers failed with no error text anywhere', async () => {
      const failing: ActionAdapter<unknown> = {
        name: 'rules.echo',
        description: 'Failing opted-in adapter for standing-rule tests.',
        tier: 2,
        argsSchema: Schema.Struct({ value: Schema.String }),
        describe: () => ({ summary: 'fails' }),
        allowAlways: true,
        execute: async () => {
          throw new Error('SECRET-RULE-FAILURE');
        },
      };
      const context = await createTestContext();
      try {
        const gateway = createActionGateway({
          db: context.db,
          adapters: buildRegistry([failing]),
          audit: createAuditRecorder({ db: context.db }),
          logger: { warn: () => undefined, error: () => undefined },
          now: () => new Date(),
        });
        const ownerId = await seedUser(context);
        const { aiId } = await seedAi(context, ownerId);
        await createRule(
          context.db,
          { aiId, groupId: null, topicId: null, action: 'rules.echo', createdBy: ownerId },
          ruleNow,
        );
        const outcome = await gateway.request({
          aiId,
          action: 'rules.echo',
          args: { value: 'boom' },
          requestedBy: 'ai-bot@zilar.localhost',
        });
        expect(outcome).toEqual({ status: 'failed' });
        // Every column: the error text must be absent from the whole row.
        const auditRows = await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<AuditRow>`SELECT * FROM audit_log`;
          }),
        );
        expect(JSON.stringify(auditRows)).not.toContain('SECRET-RULE-FAILURE');
        expect(auditRows.find((row) => row.action === 'action.auto_approved')).toBeDefined();
        expect(auditRows.find((row) => row.action === 'action.failed')).toBeDefined();
      } finally {
        await context.close();
      }
    });

    it('a stopped AI with a rule is denied and nothing runs', async () => {
      const ruled = await buildRuledHarness();
      try {
        const ownerId = await seedUser(ruled.context);
        const { aiId } = await seedAi(ruled.context, ownerId, { status: 'stopped' });
        await createRule(
          ruled.context.db,
          { aiId, groupId: null, topicId: null, action: 'rules.echo', createdBy: ownerId },
          ruleNow,
        );
        const outcome = await ruled.gateway.request({
          aiId,
          action: 'rules.echo',
          args: { value: 'nope' },
          requestedBy: 'ai-bot@zilar.localhost',
        });
        expect(outcome).toEqual({ status: 'denied', reason: 'ai_not_active' });
        expect(ruled.picked.calls).toHaveLength(0);
        expect(
          ruled.auditEntries.find((entry) => entry.action === 'action.auto_approved'),
        ).toBeUndefined();
      } finally {
        await ruled.context.close();
      }
    });

    it('a rule is ignored once the adapter loses eligibility', async () => {
      const context = await createTestContext();
      try {
        const noLongerEligible: ActionAdapter<unknown> = {
          name: 'rules.echo',
          description: 'Same action, no longer opted in.',
          tier: 2,
          argsSchema: Schema.Struct({ value: Schema.String }),
          describe: (args) => ({ summary: `Echo ${(args as { value: string }).value}` }),
          execute: async () => ({ summary: 'Echoed' }),
        };
        const gateway = createActionGateway({
          db: context.db,
          adapters: buildRegistry([noLongerEligible]),
          audit: createAuditRecorder({ db: context.db }),
          logger: { warn: () => undefined, error: () => undefined },
          now: () => new Date(),
        });
        const ownerId = await seedUser(context);
        const { aiId } = await seedAi(context, ownerId);
        await createRule(
          context.db,
          { aiId, groupId: null, topicId: null, action: 'rules.echo', createdBy: ownerId },
          ruleNow,
        );
        const outcome = await gateway.request({
          aiId,
          action: 'rules.echo',
          args: { value: 'card-again' },
          requestedBy: 'ai-bot@zilar.localhost',
        });
        expect(outcome.status).toBe('pending_approval');
      } finally {
        await context.close();
      }
    });
  });
});
