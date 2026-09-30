import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { groupAis, groupInviteLinks, groupMembers, groups } from '../db/schema';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { syncTopicRoom } from '../topics/rooms';
import { topics } from '../db/schema';
import { MAX_GROUP_MEMBERS, type InviteLogger } from '../groups/service';

export const INVITE_LINK_TOKEN_BYTES = 32;
export const INVITE_LINK_TOKEN_HEX_LENGTH = INVITE_LINK_TOKEN_BYTES * 2;
export const INVITE_LINK_LABEL_MAX = 60;
export const INVITE_LINK_CREATE_MAX_USES = 10000;
export const INVITE_LINK_CREATE_MAX_EXPIRY_HOURS = 8760;
export const INVITE_LINK_MIN_EXPIRY_HOURS = 1;
export const INVITE_LINK_MIN_MAX_USES = 1;
export const MAX_ACTIVE_INVITE_LINKS = 10;

export const JOIN_RATE_LIMIT_MAX_PER_USER = 20;
export const JOIN_RATE_LIMIT_MAX_PER_IP = 60;
export const JOIN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
// The preview reveals only a title and a count for a valid link, but probing
// tokens at full speed must still be expensive: 120 previews per hour.
export const JOIN_PREVIEW_RATE_LIMIT_MAX_PER_USER = 120;
export const JOIN_PREVIEW_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export type GroupInviteLinkRow = typeof groupInviteLinks.$inferSelect;

export interface InviteLinkView {
  id: string;
  label: string | null;
  tokenHint: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}

export interface JoinPreview {
  groupTitle: string;
  memberCount: number;
  alreadyMember: boolean;
  // The group id, present only when `alreadyMember` is true: a member
  // already knows it, and the join page uses it to open the group chat.
  // Never sent for non-members, so previews leak no ids to strangers.
  groupId?: string | undefined;
}

// Byte-identical for an unknown token, an expired link, a revoked link and
// an exhausted link, so failure answers never reveal why a link fails.
export const INVALID_LINK = {
  status: 404 as const,
  code: 'invalid_link',
  message: 'This invite link is invalid or has expired',
};

export function toInvalidLink(): HttpError {
  return new HttpError(INVALID_LINK.status, INVALID_LINK.code, INVALID_LINK.message);
}

// The raw token is shown once at creation and never stored — only its
// SHA-256 hash reaches the database, the logs or the audit trail.
export function generateInviteToken(): string {
  return randomBytes(INVITE_LINK_TOKEN_BYTES).toString('hex');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// Constant time over the hash digest, so a local timing oracle cannot probe
// token prefixes.
export function inviteTokenMatches(token: string, storedHashHex: string): boolean {
  let candidate: Buffer;
  let stored: Buffer;
  try {
    candidate = Buffer.from(hashInviteToken(token), 'hex');
    stored = Buffer.from(storedHashHex, 'hex');
  } catch {
    return false;
  }
  if (candidate.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(candidate, stored);
}

export function tokenHintFor(token: string): string {
  return token.slice(-4);
}

export function toInviteLinkView(row: GroupInviteLinkRow): InviteLinkView {
  return {
    id: row.id,
    label: row.label,
    tokenHint: row.tokenHint,
    uses: row.uses,
    maxUses: row.maxUses,
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    revoked: row.revokedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface InviteLinkServiceDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
  /** Override the clock in tests. Defaults to the wall clock. */
  now?: () => Date;
}

export interface CreateInviteLinkInput {
  groupId: string;
  actorId: string;
  label?: string | undefined;
  expiresInHours?: number | undefined;
  maxUses?: number | undefined;
}

export interface CreatedInviteLink {
  id: string;
  /** The raw token, shown once. Never stored, logged or audited. */
  token: string;
  url: string;
}

function serviceNow(deps: InviteLinkServiceDeps): Date {
  return deps.now ? deps.now() : new Date();
}

async function requireGroupManager(
  db: ServerDatabase,
  groupId: string,
  actorId: string,
): Promise<{ id: string; title: string }> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  const [membership] = group
    ? await db
        .select({ role: groupMembers.role })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, actorId)))
        .limit(1)
    : [];
  // A non-member sees the same 404 as a missing group, so group ids cannot
  // be probed.
  if (!group || !membership) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  if (membership.role === 'member') {
    throw new HttpError(403, 'forbidden', 'Only owners and admins can manage invite links');
  }
  return { id: group.id, title: group.title };
}

function linkIsExpired(row: GroupInviteLinkRow, now: Date): boolean {
  return row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime();
}

function linkIsExhausted(row: GroupInviteLinkRow): boolean {
  return row.maxUses !== null && row.uses >= row.maxUses;
}

export function linkIsUsable(row: GroupInviteLinkRow, now: Date): boolean {
  return row.revokedAt === null && !linkIsExpired(row, now) && !linkIsExhausted(row);
}

export async function createInviteLink(
  deps: InviteLinkServiceDeps,
  webBaseUrl: string,
  input: CreateInviteLinkInput,
): Promise<CreatedInviteLink> {
  await requireGroupManager(deps.db, input.groupId, input.actorId);

  const active = await deps.db
    .select({ total: count() })
    .from(groupInviteLinks)
    .where(and(eq(groupInviteLinks.groupId, input.groupId), isNull(groupInviteLinks.revokedAt)));
  if (Number(active[0]?.total ?? 0) >= MAX_ACTIVE_INVITE_LINKS) {
    throw new HttpError(409, 'too_many_links', 'This group already has 10 active invite links');
  }

  const now = serviceNow(deps);
  const token = generateInviteToken();
  const [row] = await deps.db
    .insert(groupInviteLinks)
    .values({
      id: randomUUID(),
      groupId: input.groupId,
      tokenHash: hashInviteToken(token),
      tokenHint: tokenHintFor(token),
      label: input.label ?? null,
      createdBy: input.actorId,
      expiresAt:
        input.expiresInHours === undefined
          ? null
          : new Date(now.getTime() + input.expiresInHours * 60 * 60 * 1000),
      maxUses: input.maxUses ?? null,
    })
    .returning();
  if (!row) {
    throw new Error('invite link disappeared right after creation');
  }

  if (deps.audit) {
    await deps.audit.record({
      actorUserId: input.actorId,
      aiId: null,
      groupId: input.groupId,
      action: 'group.link_created',
      subjectId: row.id,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: { linkId: row.id, hint: row.tokenHint },
    });
  }

  return { id: row.id, token, url: joinUrlFor(webBaseUrl, token) };
}

export async function listInviteLinks(
  deps: InviteLinkServiceDeps,
  groupId: string,
  actorId: string,
): Promise<InviteLinkView[]> {
  await requireGroupManager(deps.db, groupId, actorId);
  const rows = await deps.db
    .select()
    .from(groupInviteLinks)
    .where(eq(groupInviteLinks.groupId, groupId));
  return rows
    .map(toInviteLinkView)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export async function revokeInviteLink(
  deps: InviteLinkServiceDeps,
  groupId: string,
  actorId: string,
  linkId: string,
): Promise<void> {
  await requireGroupManager(deps.db, groupId, actorId);
  const now = serviceNow(deps);
  const [row] = await deps.db
    .update(groupInviteLinks)
    .set({ revokedAt: now })
    .where(
      and(
        eq(groupInviteLinks.id, linkId),
        eq(groupInviteLinks.groupId, groupId),
        isNull(groupInviteLinks.revokedAt),
      ),
    )
    .returning();
  // Idempotent: revoking twice (or revoking a missing id) still answers 204.
  // The audit entry fires only on the first revoke, when the row changed.
  if (!row) {
    return;
  }
  if (deps.audit) {
    await deps.audit.record({
      actorUserId: actorId,
      aiId: null,
      groupId,
      action: 'group.link_revoked',
      subjectId: row.id,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: { linkId: row.id, hint: row.tokenHint },
    });
  }
}

async function findLinkRow(db: ServerDatabase, token: string): Promise<GroupInviteLinkRow | null> {
  const hash = hashInviteToken(token);
  const [row] = await db
    .select()
    .from(groupInviteLinks)
    .where(eq(groupInviteLinks.tokenHash, hash))
    .limit(1);
  // The lookup is by hash, so a wrong-shaped token simply misses. The
  // constant-time comparison keeps a slow local oracle from helping a
  // guesser confirm prefixes.
  if (!row || !inviteTokenMatches(token, row.tokenHash)) {
    return null;
  }
  return row;
}

async function groupTitleOf(db: ServerDatabase, groupId: string): Promise<string | null> {
  const [group] = await db
    .select({ title: groups.title })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return group?.title ?? null;
}

async function countGroupMembers(db: ServerDatabase, groupId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return Number(row?.total ?? 0);
}

async function isGroupMember(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return row !== undefined;
}

// The preview for `GET /api/join/:token`: the group title and member count,
// never member names — and never the group id, unless the caller is already
// a member (they know it; the join page uses it to open the group chat).
// Unknown/expired/revoked/exhausted links answer the same 404 `invalid_link`,
// so failures never reveal why.
export async function previewInviteLink(
  deps: InviteLinkServiceDeps,
  token: string,
  userId: string,
): Promise<JoinPreview> {
  const row = await findLinkRow(deps.db, token);
  if (!row || !linkIsUsable(row, serviceNow(deps))) {
    throw toInvalidLink();
  }
  const title = await groupTitleOf(deps.db, row.groupId);
  if (title === null) {
    throw toInvalidLink();
  }
  const [memberCount, alreadyMember] = await Promise.all([
    countGroupMembers(deps.db, row.groupId),
    isGroupMember(deps.db, row.groupId, userId),
  ]);
  return {
    groupTitle: title,
    memberCount,
    alreadyMember,
    ...(alreadyMember ? { groupId: row.groupId } : {}),
  };
}

export interface JoinByLinkResult {
  groupId: string;
  alreadyMember: boolean;
}

// Adds the caller as a `member` through the existing add-member flow, so
// room sync, public topics and the audit entry all happen. The group-full
// check runs before any use is consumed, so a full group never burns a use.
// The membership re-check, the claim and the insert share one transaction.
// What that guarantees, per race:
// - Same user twice: the loser either sees the committed row in the in-tx
//   re-check, or both claimed and its insert is a no-op (`onConflictDoNothing`
//   returns no row, the unique index is the backstop). Either way it answers
//   200 with `alreadyMember: true` and consumes nothing: its own claim rolls
//   back with the transaction.
// - Two strangers on a 1-use link: the conditional claim UPDATE is the
//   backstop — at most `max_uses` of them win. The loser's claim updates no
//   row, so it answers the same 404 `invalid_link` (never `alreadyMember`).
// - A room failure after the claim answers 503 and the claim rolls back,
//   so a 503 never burns a use either.
// There is no `SELECT ... FOR UPDATE` or advisory lock here: strangers
// serialize on the link row through the conditional claim, and same-user
// claims on an under-cap link can both land momentarily — the unique index
// plus the no-row check is what makes the loser consume nothing.
// Already a member answers 200 with `alreadyMember: true` and consumes no
// use (fast path, before the transaction). A full group answers 409
// `group_full`.
// Unknown/expired/revoked/exhausted links answer the same 404 `invalid_link`.
export async function joinByInviteLink(
  deps: InviteLinkServiceDeps,
  token: string,
  userId: string,
): Promise<JoinByLinkResult> {
  const now = serviceNow(deps);
  const link = await findLinkRow(deps.db, token);
  if (!link || !linkIsUsable(link, now)) {
    throw toInvalidLink();
  }
  const [group] = await deps.db.select().from(groups).where(eq(groups.id, link.groupId)).limit(1);
  if (!group) {
    throw toInvalidLink();
  }
  if (await isGroupMember(deps.db, link.groupId, userId)) {
    return { groupId: link.groupId, alreadyMember: true };
  }
  await assertGroupHasRoom(deps.db, link.groupId);

  const joined = await deps.db.transaction(async (tx) => {
    // `tx` runs the claim and the insert atomically; the cast matches the
    // codebase precedent (`createRule(tx as unknown as ServerDatabase …)`).
    const txDb = tx as unknown as ServerDatabase;
    const [existing] = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, link.groupId), eq(groupMembers.userId, userId)))
      .limit(1);
    if (existing) {
      return false;
    }
    const claimed = await claimLinkUse(txDb, link.id, now);
    if (!claimed) {
      throw toInvalidLink();
    }
    try {
      await deps.adminClient.setAffiliation(
        group.roomLocalpart,
        jidFor(localpartFor(userId), deps.domain),
        'member',
      );
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
    }
    const inserted = await txDb
      .insert(groupMembers)
      .values({ groupId: link.groupId, userId, role: 'member' })
      .onConflictDoNothing({ target: [groupMembers.groupId, groupMembers.userId] })
      .returning();
    // No row inserted: another writer won the race and committed first. No
    // membership was created, so the claim above rolls back with the
    // transaction and nothing is consumed.
    return inserted.length > 0;
  });
  if (!joined) {
    return { groupId: link.groupId, alreadyMember: true };
  }
  await syncPublicTopicsByLink(deps, link.groupId);
  try {
    await deps.adminClient.sendDirectInvitation(group.roomLocalpart, [
      jidFor(localpartFor(userId), deps.domain),
    ]);
  } catch (error) {
    deps.logger.warn(
      { err: error, roomLocalpart: group.roomLocalpart, members: 1 },
      'could not send the group invitations',
    );
  }
  if (deps.audit) {
    await deps.audit.record({
      actorUserId: userId,
      aiId: null,
      groupId: link.groupId,
      action: 'group.joined_by_link',
      subjectId: link.id,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: { linkId: link.id, hint: link.tokenHint },
    });
  }
  return { groupId: link.groupId, alreadyMember: false };
}

// The group-full check, run before any use is claimed: people and AIs share
// MAX_GROUP_MEMBERS. Throws 409 `group_full` when the newcomer would exceed
// it. This check and the insert are not atomic: two strangers racing for the
// last seat can both pass it and both join, exceeding the cap by one — the
// same known race as the existing add-member flow (`addGroupMembers`), which
// checks the cap before its transaction without a serializing lock. Accepted.
async function assertGroupHasRoom(db: ServerDatabase, groupId: string): Promise<void> {
  const [row] = await db
    .select({ total: count() })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  const memberTotal = Number(row?.total ?? 0);
  const [aiRow] = await db
    .select({ total: count() })
    .from(groupAis)
    .where(eq(groupAis.groupId, groupId));
  if (memberTotal + Number(aiRow?.total ?? 0) + 1 > MAX_GROUP_MEMBERS) {
    throw new HttpError(409, 'group_full', 'This group is full');
  }
}

// Atomically consumes one use: the update only lands while the link is
// usable, so racing joins serialize on the row and at most `max_uses` of
// them win. Returns true when this caller won a use.
async function claimLinkUse(db: ServerDatabase, linkId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(groupInviteLinks)
    .set({ uses: sql`${groupInviteLinks.uses} + 1` })
    .where(
      and(
        eq(groupInviteLinks.id, linkId),
        isNull(groupInviteLinks.revokedAt),
        sql`(${groupInviteLinks.expiresAt} IS NULL OR ${groupInviteLinks.expiresAt} > ${now})`,
        sql`(${groupInviteLinks.maxUses} IS NULL OR ${groupInviteLinks.uses} < ${groupInviteLinks.maxUses})`,
      ),
    )
    .returning();
  return rows.length > 0;
}

// The post-commit half of a link join: every public topic room gains the
// newcomer, then the newcomer is invited to the group room. Link joins
// ignore the contacts rule on purpose: the link is the introduction. Topic
// sync is best effort after the commit, like the group flows: a failure is
// logged with the group id (never a topic name), never thrown.
async function syncPublicTopicsByLink(deps: InviteLinkServiceDeps, groupId: string): Promise<void> {
  const topicRows = await deps.db.select().from(topics).where(eq(topics.groupId, groupId));
  for (const topic of topicRows) {
    if (topic.archivedAt !== null) {
      continue;
    }
    try {
      await syncTopicRoom(
        { db: deps.db, adminClient: deps.adminClient, domain: deps.domain, logger: deps.logger },
        topic,
      );
    } catch {
      deps.logger.warn({ groupId }, 'could not sync a topic room after a link join');
    }
  }
}

export function joinUrlFor(webBaseUrl: string, token: string): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/j/${token}`;
}
