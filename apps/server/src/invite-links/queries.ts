import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { GroupInviteLinkRow, GroupRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { findGroupMembership, isGroupManagerRole } from '../groups/access';
import {
  MAX_ACTIVE_INVITE_LINKS,
  generateInviteToken,
  hashInviteToken,
  inviteTokenMatches,
  joinUrlFor,
  toInviteLinkView,
  tokenHintFor,
  type CreateInviteLinkInput,
  type CreatedInviteLink,
  type InviteLinkServiceDeps,
  type InviteLinkView,
} from './tokens';

export function serviceNow(deps: InviteLinkServiceDeps): Date {
  return deps.now ? deps.now() : new Date();
}

async function requireGroupManager(
  db: ServerDatabase,
  groupId: string,
  actorId: string,
): Promise<{ id: string; title: string }> {
  const [group] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRow>`SELECT * FROM groups WHERE id = ${groupId} LIMIT 1`;
    }),
  );
  const membership = group ? await findGroupMembership(db, groupId, actorId) : undefined;
  // A non-member sees the same 404 as a missing group.
  if (!group || !membership) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  if (!isGroupManagerRole(membership.role)) {
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

  const [active] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM group_invite_links
        WHERE group_id = ${input.groupId} AND revoked_at IS NULL`;
    }),
  );
  if (Number(active?.total ?? 0) >= MAX_ACTIVE_INVITE_LINKS) {
    throw new HttpError(409, 'too_many_links', 'This group already has 10 active invite links');
  }

  const now = serviceNow(deps);
  const token = generateInviteToken();
  const expiresAt =
    input.expiresInHours === undefined
      ? null
      : new Date(now.getTime() + input.expiresInHours * 60 * 60 * 1000);
  const [row] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupInviteLinkRow>`INSERT INTO group_invite_links
          (id, group_id, token_hash, token_hint, label, created_by, expires_at, max_uses)
        VALUES (
          ${randomUUID()},
          ${input.groupId},
          ${hashInviteToken(token)},
          ${tokenHintFor(token)},
          ${input.label ?? null},
          ${input.actorId},
          ${expiresAt === null ? null : expiresAt.toISOString()},
          ${input.maxUses ?? null}
        )
        RETURNING *`;
    }),
  );
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
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupInviteLinkRow>`SELECT * FROM group_invite_links
        WHERE group_id = ${groupId}`;
    }),
  );
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
  const [row] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupInviteLinkRow>`UPDATE group_invite_links SET revoked_at = ${now.toISOString()}
        WHERE id = ${linkId} AND group_id = ${groupId} AND revoked_at IS NULL
        RETURNING *`;
    }),
  );
  // Idempotent; the audit entry fires only when the row changed.
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

export async function findLinkRow(
  db: ServerDatabase,
  token: string,
): Promise<GroupInviteLinkRow | null> {
  const hash = hashInviteToken(token);
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupInviteLinkRow>`SELECT * FROM group_invite_links
        WHERE token_hash = ${hash} LIMIT 1`;
    }),
  );
  // The lookup is by hash, so a wrong-shaped token misses. Constant-time comparison keeps
  // a local timing oracle from confirming prefixes.
  if (!row || !inviteTokenMatches(token, row.tokenHash)) {
    return null;
  }
  return row;
}

export async function countGroupMembers(db: ServerDatabase, groupId: string): Promise<number> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // A group's members are its people and its AIs.
      return yield* sql<{ total: number }>`SELECT (
          (SELECT count(*) FROM group_members WHERE group_id = ${groupId})
          + (SELECT count(*) FROM group_ais WHERE group_id = ${groupId})
        )::int AS total`;
    }),
  );
  return Number(row?.total ?? 0);
}

export async function isGroupMember(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId} LIMIT 1`;
    }),
  );
  return row !== undefined;
}
