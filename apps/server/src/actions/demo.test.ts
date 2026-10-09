import { randomUUID } from 'node:crypto';
import { Effect, Exit, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { decideApproval } from '../approvals/service';
import { type AuditEntry, type AuditRecorder, createAuditRecorder } from '../audit/service';
import { createActionGateway, type ActionGateway, type ActionGatewayLogger } from './gateway';
import { buildRegistry, decodeActionArgs, type ActionAdapter } from './registry';
import { DEMO_ECHO_ACTION, buildDemoEchoAdapter, DemoEchoArgsSchema } from './demo';

interface ApprovalSummaryRow {
  summary: string;
  argsHash: string;
}

interface PendingStatusRow {
  status: string;
}

interface PendingResultRow extends PendingStatusRow {
  resultSummary: string | null;
}

interface CapturingRecorder extends AuditRecorder {
  entries: AuditEntry[];
}

function captureRecorder(db: TestContext['db']): CapturingRecorder {
  const entries: AuditEntry[] = [];
  const real = createAuditRecorder({ db });
  return {
    entries,
    async record(entry) {
      entries.push(entry);
      await real.record(entry);
    },
  };
}

async function seedUser(context: TestContext): Promise<string> {
  const id = randomUUID();
  const email = `${id}@example.com`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO "user" (id, name, email) VALUES (${id}, 'Owner', ${email})`;
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
  aiId: string,
): Promise<{ groupId: string }> {
  const groupId = randomUUID();
  const roomLocalpart = `g${randomUUID().replace(/-/g, '').slice(0, 15)}`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO groups (id, room_localpart, title, created_by) VALUES (${groupId}, ${roomLocalpart}, 'Crew', ${ownerId})`;
      yield* sql`INSERT INTO group_members (group_id, user_id, role) VALUES (${groupId}, ${ownerId}, 'owner')`;
      yield* sql`INSERT INTO group_ais (group_id, ai_id, added_by) VALUES (${groupId}, ${aiId}, ${ownerId})`;
    }),
  );
  return { groupId };
}

interface Harness {
  context: TestContext;
  gateway: ActionGateway;
  adapter: ActionAdapter<unknown>;
  calls: Array<{ ctx: unknown; args: unknown }>;
  audit: CapturingRecorder;
}

async function buildHarness(): Promise<Harness> {
  const context = await createTestContext();
  const calls: Array<{ ctx: unknown; args: unknown }> = [];
  const adapter: ActionAdapter<unknown> = {
    ...buildDemoEchoAdapter(),
    execute: async (ctx, args) => {
      calls.push({ ctx, args });
      return { summary: `Echoed: ${(args as { text: string }).text}` };
    },
  };
  const audit = captureRecorder(context.db);
  const logger: ActionGatewayLogger = {
    warn: () => undefined,
    error: () => undefined,
  };
  const registry = buildRegistry([adapter]);
  const gateway = createActionGateway({
    db: context.db,
    adapters: registry,
    audit,
    logger,
    now: () => new Date(),
  });
  return {
    context,
    gateway,
    adapter,
    calls,
    audit,
  };
}

describe('demo.echo adapter', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await buildHarness();
  });

  afterEach(async () => {
    await harness.context.close();
  });

  it('is tier 2 and has a description under the cap', () => {
    expect(harness.adapter.tier).toBe(2);
    expect(harness.adapter.name).toBe(DEMO_ECHO_ACTION);
    expect(harness.adapter.description.length).toBeGreaterThan(0);
    expect(harness.adapter.description.length).toBeLessThanOrEqual(200);
  });

  it('rejects args outside the 1..200 char bound', () => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(DemoEchoArgsSchema)({ text: '' }))).toBe(false);
    expect(Exit.isSuccess(Schema.decodeUnknownExit(DemoEchoArgsSchema)({ text: '   ' }))).toBe(
      false,
    );
    expect(
      Exit.isSuccess(Schema.decodeUnknownExit(DemoEchoArgsSchema)({ text: 'x'.repeat(201) })),
    ).toBe(false);
    expect(Exit.isSuccess(Schema.decodeUnknownExit(DemoEchoArgsSchema)({ text: 'hello' }))).toBe(
      true,
    );
    expect(decodeActionArgs(DemoEchoArgsSchema, { text: 'hello', extra: 1 }).ok).toBe(false);
  });

  it('posts a card on request and runs the adapter exactly once after approval', async () => {
    const ownerId = await seedUser(harness.context);
    const { aiId } = await seedAi(harness.context, ownerId);
    const result = await harness.gateway.request({
      aiId,
      action: DEMO_ECHO_ACTION,
      args: { text: 'hello' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    expect(result).toEqual({ status: 'pending_approval', approvalId: expect.any(String) });
    if (result.status !== 'pending_approval') {
      throw new Error('expected pending_approval');
    }
    const [row] = await testSql(harness.context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<ApprovalSummaryRow>`SELECT summary, args_hash FROM approvals WHERE id = ${result.approvalId}`;
      }),
    );
    expect(row?.summary).toBe('Echo a message: "hello"');
    expect(row?.argsHash).toMatch(/^[0-9a-f]{64}$/);

    // Nothing ran yet: the adapter is not called until approval.
    expect(harness.calls).toHaveLength(0);
    const pendingBefore = await testSql(harness.context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<PendingStatusRow>`SELECT status FROM pending_actions`;
      }),
    );
    expect(pendingBefore).toHaveLength(1);
    expect(pendingBefore[0]?.status).toBe('waiting');

    await decideApproval(
      harness.context.db,
      { approvalId: result.approvalId, userId: ownerId, decision: 'approve_once' },
      new Date(),
    );
    await harness.gateway.onApprovalDecided(result.approvalId);

    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]?.args).toEqual({ text: 'hello' });
    expect(harness.calls[0]?.ctx).toMatchObject({ aiId, groupId: null });
    const pendingAfter = await testSql(harness.context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<PendingResultRow>`SELECT status, result_summary FROM pending_actions WHERE approval_id = ${result.approvalId}`;
      }),
    );
    expect(pendingAfter[0]?.status).toBe('executed');
    expect(pendingAfter[0]?.resultSummary).toBe('Echoed: hello');
    const actions = harness.audit.entries.map((entry) => entry.action);
    expect(actions).toContain('action.requested');
    expect(actions).toContain('action.executed');
    const dump = JSON.stringify(harness.audit.entries);
    expect(dump).not.toContain('hello');
  });

  it('never runs when the owner denies the request', async () => {
    const ownerId = await seedUser(harness.context);
    const { aiId } = await seedAi(harness.context, ownerId);
    const result = await harness.gateway.request({
      aiId,
      action: DEMO_ECHO_ACTION,
      args: { text: 'nope' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    if (result.status !== 'pending_approval') {
      throw new Error('expected pending_approval');
    }
    await decideApproval(
      harness.context.db,
      { approvalId: result.approvalId, userId: ownerId, decision: 'deny' },
      new Date(),
    );
    await harness.gateway.onApprovalDecided(result.approvalId);
    expect(harness.calls).toHaveLength(0);
    const [pending] = await testSql(harness.context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<PendingStatusRow>`SELECT status FROM pending_actions WHERE approval_id = ${result.approvalId}`;
      }),
    );
    expect(pending?.status).toBe('cancelled');
  });

  it('never runs when the AI is stopped before approval fires', async () => {
    const ownerId = await seedUser(harness.context);
    const { aiId } = await seedAi(harness.context, ownerId);
    const result = await harness.gateway.request({
      aiId,
      action: DEMO_ECHO_ACTION,
      args: { text: 'kill' },
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
    await testSql(harness.context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE ais SET status = 'stopped' WHERE id = ${aiId}`;
      }),
    );
    await harness.gateway.onApprovalDecided(result.approvalId);
    expect(harness.calls).toHaveLength(0);
    const [pending] = await testSql(harness.context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<PendingStatusRow>`SELECT status FROM pending_actions WHERE approval_id = ${result.approvalId}`;
      }),
    );
    expect(pending?.status).toBe('cancelled');
  });

  it('records no secret when the adapter throws (and no echo of the text)', async () => {
    const context = await createTestContext();
    try {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const secretError = new Error('SECRET-DO-NOT-LOG');
      const calls: Array<{ ctx: unknown; args: unknown }> = [];
      const failing: ActionAdapter<unknown> = {
        ...buildDemoEchoAdapter(),
        execute: async (ctx, args) => {
          calls.push({ ctx, args });
          throw secretError;
        },
      };
      const audit = captureRecorder(context.db);
      const logger: ActionGatewayLogger = {
        warn: () => undefined,
        error: () => undefined,
      };
      const gateway = createActionGateway({
        db: context.db,
        adapters: buildRegistry([failing]),
        audit,
        logger,
        now: () => new Date(),
      });
      const result = await gateway.request({
        aiId,
        action: DEMO_ECHO_ACTION,
        args: { text: 'boom' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      // Tier 2 still needs approval; onApprovalDecided runs the adapter.
      if (result.status !== 'pending_approval') {
        throw new Error('expected pending_approval');
      }
      await decideApproval(
        context.db,
        { approvalId: result.approvalId, userId: ownerId, decision: 'approve_once' },
        new Date(),
      );
      await gateway.onApprovalDecided(result.approvalId);
      expect(calls).toHaveLength(1);
      const rows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql`SELECT * FROM audit_log`;
        }),
      );
      // The error text from the adapter never reaches rows, audit, return value, or any logger line.
      const auditDump = JSON.stringify({ rows, auditEntries: audit.entries });
      expect(auditDump).not.toContain('SECRET-DO-NOT-LOG');
      expect(auditDump).not.toContain('boom');
      const failed = audit.entries.find((entry) => entry.action === 'action.failed');
      expect(failed?.result).toBe('error');
    } finally {
      await context.close();
    }
  });

  it('denies with reason ai_not_in_group when the AI is not in the requested group', async () => {
    const ownerId = await seedUser(harness.context);
    const { aiId } = await seedAi(harness.context, ownerId);
    // A different AI is the member of the group, so this AI is not in it.
    const otherAi = await seedAi(harness.context, ownerId);
    const { groupId } = await seedGroup(harness.context, ownerId, otherAi.aiId);
    const result = await harness.gateway.request({
      aiId,
      groupId,
      action: DEMO_ECHO_ACTION,
      args: { text: 'group' },
      requestedBy: 'ai-bot@zilar.localhost',
    });
    expect(result).toEqual({ status: 'denied', reason: 'ai_not_in_group' });
  });
});
