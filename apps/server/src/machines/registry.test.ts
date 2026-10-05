import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerDatabase } from '../db/client';
import { machines } from '../db/schema';
import { bootstrapUser, createTestContext, testApp, type TestContext } from '../test-support';
import { createDbMachineRegistry } from './registry';

describe('db machine registry', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  async function insertMachine(
    db: ServerDatabase,
    owner: string,
    overrides: { status?: 'pending' | 'approved' | 'revoked'; publicKey?: string } = {},
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(machines).values({
      id,
      ownerUserId: owner,
      name: 'julio-mbp',
      publicKey: overrides.publicKey ?? `public-key-for-${id}`,
      capabilities: { os: 'macos' },
      status: overrides.status ?? 'approved',
    });
    return id;
  }

  it('returns the key for an approved machine', async () => {
    const app = testApp(context);
    const user = await bootstrapUser(context, app, 'owner@example.com');
    const id = await insertMachine(context.db, user.id, {
      status: 'approved',
      publicKey: 'approved-key',
    });

    const registry = createDbMachineRegistry(context.db);
    await expect(registry.getApprovedPublicKey(id)).resolves.toBe('approved-key');
  });

  it('returns null for pending, revoked and unknown machines', async () => {
    const app = testApp(context);
    const user = await bootstrapUser(context, app, 'owner@example.com');
    const pending = await insertMachine(context.db, user.id, { status: 'pending' });
    const revoked = await insertMachine(context.db, user.id, { status: 'revoked' });

    const registry = createDbMachineRegistry(context.db);
    await expect(registry.getApprovedPublicKey(pending)).resolves.toBeNull();
    await expect(registry.getApprovedPublicKey(revoked)).resolves.toBeNull();
    await expect(registry.getApprovedPublicKey(randomUUID())).resolves.toBeNull();
  });

  it('writes last_seen_at without touching anything else', async () => {
    const app = testApp(context);
    const user = await bootstrapUser(context, app, 'owner@example.com');
    const id = await insertMachine(context.db, user.id, { status: 'approved' });

    const registry = createDbMachineRegistry(context.db);
    const at = new Date('2026-09-28T12:00:00.000Z');
    await registry.touchLastSeen(id, at);

    const [row] = await context.db.select().from(machines).where(eq(machines.id, id));
    expect(row?.lastSeenAt).toEqual(at);
    expect(row?.status).toBe('approved');

    // A missing id is a no-op, not an error.
    await registry.touchLastSeen(randomUUID(), at);
  });

  it('emits revokes to listeners synchronously and unsubscribes', async () => {
    const registry = createDbMachineRegistry(context.db);
    const seen: string[] = [];
    const unsubscribe = registry.onRevoke((machineId) => {
      seen.push(machineId);
    });
    const other: string[] = [];
    registry.onRevoke((machineId) => {
      other.push(machineId);
    });

    registry.notifyRevoked('machine-1');
    expect(seen).toEqual(['machine-1']);
    expect(other).toEqual(['machine-1']);

    unsubscribe();
    registry.notifyRevoked('machine-2');
    expect(seen).toEqual(['machine-1']);
    expect(other).toEqual(['machine-1', 'machine-2']);
  });

  it('emits approves to listeners synchronously with the public key and unsubscribes', async () => {
    const registry = createDbMachineRegistry(context.db);
    const seen: Array<{ id: string; publicKey: string }> = [];
    const unsubscribe = registry.onApprove((machineId, publicKey) => {
      seen.push({ id: machineId, publicKey });
    });

    registry.notifyApproved('machine-1', 'key-1');
    expect(seen).toEqual([{ id: 'machine-1', publicKey: 'key-1' }]);

    unsubscribe();
    registry.notifyApproved('machine-2', 'key-2');
    expect(seen).toEqual([{ id: 'machine-1', publicKey: 'key-1' }]);
  });
});
