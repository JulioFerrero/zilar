import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ServerDatabase } from '../db/client';
import { invites } from '../db/schema';

export const INVITE_CODE_BYTES = 16;
export const DEFAULT_INVITE_MAX_USES = 1;
export const DEFAULT_INVITE_TTL_DAYS = 7;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type Invite = typeof invites.$inferSelect;

export interface CreateInviteOptions {
  createdBy?: string | null;
  maxUses?: number;
  expiresInDays?: number;
}

export function generateInviteCode(): string {
  return randomBytes(INVITE_CODE_BYTES).toString('base64url');
}

export async function createInvite(
  db: ServerDatabase,
  options: CreateInviteOptions = {},
): Promise<Invite> {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (options.expiresInDays ?? DEFAULT_INVITE_TTL_DAYS) * DAY_IN_MS,
  );

  const [invite] = await db
    .insert(invites)
    .values({
      id: randomUUID(),
      code: generateInviteCode(),
      createdBy: options.createdBy ?? null,
      createdAt: now,
      expiresAt,
      maxUses: options.maxUses ?? DEFAULT_INVITE_MAX_USES,
      uses: 0,
    })
    .returning();

  if (!invite) {
    throw new Error('Failed to create invite');
  }
  return invite;
}

export async function findInviteByCode(db: ServerDatabase, code: string): Promise<Invite | null> {
  const [invite] = await db.select().from(invites).where(eq(invites.code, code)).limit(1);
  return invite ?? null;
}

export async function findUsableInvite(
  db: ServerDatabase,
  code: string,
  now: Date = new Date(),
): Promise<Invite | null> {
  const [invite] = await db.select().from(invites).where(usableInvite(code, now)).limit(1);
  return invite ?? null;
}

export async function consumeInvite(
  db: ServerDatabase,
  code: string,
  now: Date = new Date(),
): Promise<Invite | null> {
  const [invite] = await db
    .update(invites)
    .set({ uses: sql`${invites.uses} + 1` })
    .where(usableInvite(code, now))
    .returning();
  return invite ?? null;
}

export async function revokeInvite(
  db: ServerDatabase,
  code: string,
  now: Date = new Date(),
): Promise<Invite | null> {
  const [invite] = await db
    .update(invites)
    .set({ revokedAt: now })
    .where(and(eq(invites.code, code), isNull(invites.revokedAt)))
    .returning();
  return invite ?? null;
}

function usableInvite(code: string, now: Date) {
  return and(
    eq(invites.code, code),
    isNull(invites.revokedAt),
    gt(invites.expiresAt, now),
    lt(invites.uses, invites.maxUses),
  );
}
