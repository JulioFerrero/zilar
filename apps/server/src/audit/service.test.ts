import { randomBytes, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aiLimits, ais, auditLog, groupMembers, groups, providerConnections } from '../db/schema';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  type TestApp,
  type TestContext,
} from '../test-support';
import {
  createAuditRecorder,
  DEFAULT_AUDIT_LIST_LIMIT,
  listAuditForAi,
  listAuditForGroup,
  MAX_AUDIT_LIST_LIMIT,
  recordAudit,
  type AuditEntry,
} from './service';

interface CaptureLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
  calls: Array<{ fields: Record<string, unknown>; message: string }>;
}

function captureLogger(): CaptureLogger {
  const calls: Array<{ fields: Record<string, unknown>; message: string }> = [];
  return {
    error: (fields, message) => {
      calls.push({ fields, message });
    },
    calls,
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
  await context.db.insert(ais).values({
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

async function seedGroup(
  context: TestContext,
  ownerId: string,
  memberIds: string[],
): Promise<{ groupId: string }> {
  const groupId = randomUUID();
  const roomLocalpart = `g${randomBytes(15).toString('hex')}`;
  await context.db.insert(groups).values({
    id: groupId,
    roomLocalpart,
    title: 'Crew',
    createdBy: ownerId,
  });
  const rows = [
    { groupId, userId: ownerId, role: 'owner' as const },
    ...memberIds.map((userId) => ({ groupId, userId, role: 'member' as const })),
  ];
  for (const row of rows) {
    await context.db.insert(groupMembers).values(row);
  }
  return { groupId };
}

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

describe('audit service', () => {
  let context: TestContext;
  let now: Date;

  beforeEach(async () => {
    context = await createTestContext();
    now = new Date('2026-09-15T00:00:00Z');
  });

  afterEach(async () => {
    await context.close();
  });

  describe('recordAudit', () => {
    it('validates and inserts one row', async () => {
      await recordAudit(
        context.db,
        baseEntry({ action: 'machine.paired', subjectId: 'm1', actorUserId: 'u1' }),
        now,
      );

      const rows = await context.db.select().from(auditLog);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.action).toBe('machine.paired');
      expect(row.subjectId).toBe('m1');
      expect(row.actorUserId).toBe('u1');
      expect(row.result).toBe('ok');
      expect(row.at).toEqual(now);
      expect(row.id).toHaveLength(32);
    });

    it('names a wrong type', async () => {
      await expect(
        recordAudit(context.db, { ...baseEntry(), actorUserId: 42 } as unknown as AuditEntry, now),
      ).rejects.toThrow(/Invalid audit entry:.*Expected string/);
    });

    it('rejects an action that is not dotted', async () => {
      await expect(
        recordAudit(context.db, baseEntry({ action: 'noDotHere' }), now),
      ).rejects.toThrow(/Invalid audit entry/);
    });

    it('rejects an action that starts with a digit', async () => {
      await expect(
        recordAudit(context.db, baseEntry({ action: '4pproval.decided' }), now),
      ).rejects.toThrow(/Invalid audit entry/);
    });

    it('rejects a malformed args hash', async () => {
      await expect(
        recordAudit(context.db, baseEntry({ action: 'machine.paired', argsHash: 'not-hex' }), now),
      ).rejects.toThrow(/Invalid audit entry/);
    });

    it('rejects a detail blob larger than 2 KB', async () => {
      const fat = 'x'.repeat(3 * 1024);
      await expect(
        recordAudit(
          context.db,
          baseEntry({ action: 'machine.paired', detail: { blob: fat } }),
          now,
        ),
      ).rejects.toThrow(/detail must serialise to at most 2048 bytes/);
    });

    it('rejects an unknown result', async () => {
      await expect(
        recordAudit(
          context.db,
          // zod's strict typing keeps `result` from widening here; the schema
          // accepts any string, and the service must reject anything outside
          // the closed set.
          { ...baseEntry(), result: 'maybe' } as unknown as AuditEntry,
          now,
        ),
      ).rejects.toThrow(/Invalid audit entry/);
    });

    it('rejects an unknown top-level field', async () => {
      await expect(
        recordAudit(
          context.db,
          { ...baseEntry(), note: 'should never be stored' } as unknown as AuditEntry,
          now,
        ),
      ).rejects.toThrow(/Invalid audit entry/);
    });

    it('refuses UPDATE through the Drizzle client because of the trigger', async () => {
      await recordAudit(context.db, baseEntry(), now);
      await expect(
        context.db.update(auditLog).set({ action: 'machine.deleted' }),
      ).rejects.toThrow();
    });

    it('refuses DELETE through the Drizzle client because of the trigger', async () => {
      await recordAudit(context.db, baseEntry(), now);
      await expect(context.db.delete(auditLog)).rejects.toThrow();
    });

    it('refuses TRUNCATE because of the trigger', async () => {
      await recordAudit(context.db, baseEntry(), now);
      await expect(context.db.execute(sql`truncate table audit_log`)).rejects.toThrow();
    });
  });

  describe('createAuditRecorder', () => {
    it('writes a valid entry without logging anything on success', async () => {
      const logger = captureLogger();
      const recorder = createAuditRecorder({ db: context.db, logger, now: () => now });
      await recorder.record(baseEntry({ subjectId: 'm1' }));
      const rows = await context.db.select().from(auditLog);
      expect(rows).toHaveLength(1);
      expect(logger.calls).toHaveLength(0);
    });

    it('swallows an insert failure and logs { action } only', async () => {
      const logger = captureLogger();
      const recorder = createAuditRecorder({ db: context.db, logger, now: () => now });
      // An invalid entry reaches recordAudit which throws; the recorder must
      // catch it, never rethrow into the caller's request, and only log the
      // action so sensitive fields (actor, ai, detail) never travel through
      // the logger.
      await expect(
        recorder.record({ ...baseEntry(), action: 'no-dots' } as unknown as AuditEntry),
      ).resolves.toBeUndefined();
      expect(logger.calls).toHaveLength(1);
      const logged = logger.calls[0]!;
      expect(logged.fields['action']).toBe('no-dots');
      expect(logged.fields).not.toHaveProperty('actorUserId');
      expect(logged.fields).not.toHaveProperty('detail');
      expect(logged.fields).not.toHaveProperty('aiId');
      expect(logged.fields).not.toHaveProperty('groupId');
    });

    it('carries on after a database error', async () => {
      const logger = captureLogger();
      const recorder = createAuditRecorder({ db: context.db, logger, now: () => now });
      await expect(
        recorder.record({ ...baseEntry(), action: 'no-dots' } as unknown as AuditEntry),
      ).resolves.toBeUndefined();
      // A second valid call still succeeds.
      await recorder.record(baseEntry({ subjectId: 'm2' }));
      const rows = await context.db.select().from(auditLog);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.subjectId).toBe('m2');
    });
  });

  describe('listAuditForAi', () => {
    let aliceAiId: string;
    let alice: { id: string };
    let bob: { id: string };
    let authApp: TestApp;

    beforeEach(async () => {
      authApp = testApp(context);
      const aliceApp = await bootstrapUser(context, authApp, 'alice@x.com');
      const bobApp = await bootstrapUser(context, authApp, 'bob@x.com');
      alice = { id: aliceApp.id };
      bob = { id: bobApp.id };
      const ai = await seedAi(context, alice.id);
      aliceAiId = ai.aiId;
    });

    it('returns AI entries to the owner', async () => {
      await recordAudit(
        context.db,
        baseEntry({
          action: 'machine.paired',
          subjectId: 'm1',
          actorUserId: alice.id,
          aiId: aliceAiId,
        }),
        now,
      );
      const page = await listAuditForAi(context.db, aliceAiId, alice.id);
      expect(page.entries).toHaveLength(1);
      expect(page.entries[0]!.actorUserId).toBe(alice.id);
    });

    it('answers an empty page for a stranger (same shape as a missing id)', async () => {
      await recordAudit(
        context.db,
        baseEntry({
          action: 'machine.paired',
          subjectId: 'm1',
          actorUserId: alice.id,
          aiId: aliceAiId,
        }),
        now,
      );
      const strangerPage = await listAuditForAi(context.db, aliceAiId, bob.id);
      expect(strangerPage.entries).toEqual([]);
      expect(strangerPage.next).toBeNull();
      const missingPage = await listAuditForAi(context.db, randomUUID(), alice.id);
      expect(missingPage.entries).toEqual([]);
    });

    it('orders newest first and paginates with `before`', async () => {
      const base = new Date('2026-09-15T00:00:00Z').getTime();
      for (let i = 0; i < 5; i += 1) {
        await recordAudit(
          context.db,
          baseEntry({
            action: 'machine.paired',
            subjectId: `m${i}`,
            actorUserId: alice.id,
            aiId: aliceAiId,
          }),
          new Date(base + i * 1000),
        );
      }

      const first = await listAuditForAi(context.db, aliceAiId, alice.id, { limit: 2 });
      expect(first.entries.map((e) => e.subjectId)).toEqual(['m4', 'm3']);
      expect(first.next).not.toBeNull();

      const second = await listAuditForAi(context.db, aliceAiId, alice.id, {
        limit: 2,
        before: first.next!,
      });
      expect(second.entries.map((e) => e.subjectId)).toEqual(['m2', 'm1']);
      expect(second.next).not.toBeNull();

      const third = await listAuditForAi(context.db, aliceAiId, alice.id, {
        limit: 2,
        before: second.next!,
      });
      expect(third.entries.map((e) => e.subjectId)).toEqual(['m0']);
      expect(third.next).toBeNull();
    });

    it('honors the default and maximum limit', async () => {
      expect(DEFAULT_AUDIT_LIST_LIMIT).toBe(50);
      expect(MAX_AUDIT_LIST_LIMIT).toBe(200);
      const base = new Date('2026-09-15T00:00:00Z').getTime();
      for (let i = 0; i < 3; i += 1) {
        await recordAudit(
          context.db,
          baseEntry({
            action: 'machine.paired',
            subjectId: `m${i}`,
            actorUserId: alice.id,
            aiId: aliceAiId,
          }),
          new Date(base + i),
        );
      }
      const page = await listAuditForAi(context.db, aliceAiId, alice.id);
      expect(page.entries).toHaveLength(3);
    });
  });

  describe('listAuditForGroup', () => {
    let owner: { id: string };
    let admin: { id: string };
    let member: { id: string };
    let stranger: { id: string };
    let groupId: string;

    beforeEach(async () => {
      const authApp = testApp(context);
      const ownerApp = await bootstrapUser(context, authApp, 'owner@x.com');
      owner = { id: ownerApp.id };
      const adminApp = await contactOf(context, authApp, owner.id, 'admin@x.com');
      admin = { id: adminApp.id };
      const memberApp = await contactOf(context, authApp, owner.id, 'member@x.com');
      member = { id: memberApp.id };
      const strangerApp = await bootstrapUser(context, authApp, 'stranger@x.com');
      stranger = { id: strangerApp.id };
      const seeded = await seedGroup(context, owner.id, [admin.id, member.id]);
      groupId = seeded.groupId;
      await context.db
        .update(groupMembers)
        .set({ role: 'admin' })
        .where(eq(groupMembers.userId, admin.id));
    });

    it('returns group entries to the owner and to an admin', async () => {
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
      const ownerPage = await listAuditForGroup(context.db, groupId, owner.id);
      expect(ownerPage.entries).toHaveLength(1);
      const adminPage = await listAuditForGroup(context.db, groupId, admin.id);
      expect(adminPage.entries).toHaveLength(1);
    });

    it('answers an empty page for a plain member and a stranger', async () => {
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
      const memberPage = await listAuditForGroup(context.db, groupId, member.id);
      expect(memberPage.entries).toEqual([]);
      const strangerPage = await listAuditForGroup(context.db, groupId, stranger.id);
      expect(strangerPage.entries).toEqual([]);
      const missingPage = await listAuditForGroup(context.db, randomUUID(), owner.id);
      expect(missingPage.entries).toEqual([]);
    });

    it('orders newest first', async () => {
      const base = new Date('2026-09-15T00:00:00Z').getTime();
      for (let i = 0; i < 3; i += 1) {
        await recordAudit(
          context.db,
          baseEntry({
            action: 'approval.decided',
            subjectId: `a${i}`,
            actorUserId: owner.id,
            groupId,
          }),
          new Date(base + i * 1000),
        );
      }
      const page = await listAuditForGroup(context.db, groupId, owner.id);
      expect(page.entries.map((e) => e.subjectId)).toEqual(['a2', 'a1', 'a0']);
    });
  });
});
