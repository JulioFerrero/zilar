// The owner deletes a group: every room is destroyed outside the
// transaction, then the group row (children cascade) and the per-chat rows
// keyed by the room JIDs. Only the owner; anyone else answers 403, an
// unknown or invisible group the same 404.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { recordAudit, type AuditRecorder } from '../audit/recorder';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { destroyQuietly, requireGroup } from './queries';
import type { GroupRole, InviteLogger } from './schemas';

export interface DeleteGroupInput {
  groupId: string;
  actorId: string;
  /** The MUC domain used to build each room JID (`<localpart>@<mucDomain>`). */
  mucDomain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
}

// The chat JID of a room: `<localpart>@<mucDomain>`, lowercased.
function roomJidFor(roomLocalpart: string, mucDomain: string): string {
  return `${roomLocalpart}@${mucDomain}`.toLowerCase();
}

// The owner destroys the group: rows first (one transaction, owner check
// under a per-group advisory lock), then best-effort room destruction, then
// the chat rows that carry no foreign key.
export async function deleteGroup(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: DeleteGroupInput,
): Promise<void> {
  await requireGroup(db, input.groupId);

  // Read every room before the cascade removes the topic rows; General is a
  // topic row too, so this is all rooms.
  const rooms = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM topics
        WHERE group_id = ${input.groupId}`;
    }),
  );

  // One transaction: the owner check and the delete. The cascade removes
  // `group_members`, `topics`, `group_ais`, `group_invite_links`, `handles`,
  // roles, routines, approvals and every other table that references the
  // group.
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'group-delete:' + input.groupId}))`;
          const [actor] = yield* sql<{ role: GroupRole }>`SELECT role FROM group_members
            WHERE group_id = ${input.groupId} AND user_id = ${input.actorId} LIMIT 1`;
          if (actor === undefined) {
            return yield* Effect.fail(new HttpError(404, 'not_found', 'Group not found'));
          }
          if (actor.role !== 'owner') {
            return yield* Effect.fail(
              new HttpError(403, 'forbidden', 'Only the owner can delete the group'),
            );
          }
          yield* sql`DELETE FROM groups WHERE id = ${input.groupId}`;
        }),
      );
    }),
  );

  const roomJids: string[] = [];
  for (const room of rooms) {
    if (room.roomLocalpart === '') continue;
    roomJids.push(roomJidFor(room.roomLocalpart, input.mucDomain));
    await destroyQuietly(adminClient, room.roomLocalpart);
  }

  // The per-chat rows carry no foreign key to the group or the room, so they
  // are deleted by their JIDs (never by a user id alone) after the commit.
  if (roomJids.length > 0) {
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM chat_prefs WHERE chat_jid IN ${sql.in(roomJids)}`;
        yield* sql`DELETE FROM chat_reads WHERE chat_jid IN ${sql.in(roomJids)}`;
        yield* sql`DELETE FROM chat_deliveries WHERE chat_jid IN ${sql.in(roomJids)}`;
      }),
    );
  }

  // Audited with ids only: the group id and the number of rooms that went
  // away; a failed audit write never fails the request.
  if (input.audit) {
    try {
      await recordAudit(
        db,
        {
          actorUserId: input.actorId,
          aiId: null,
          groupId: input.groupId,
          action: 'group.deleted',
          subjectId: input.groupId,
          argsHash: null,
          costCurrency: null,
          costAmount: null,
          result: 'ok',
          detail: { groupId: input.groupId, roomCount: rooms.length },
        },
        new Date(),
      );
    } catch {
      input.logger.warn({ groupId: input.groupId }, 'could not audit a group deletion');
    }
  }
}
