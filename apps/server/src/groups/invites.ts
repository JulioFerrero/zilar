import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import type { InviteLogger } from './schemas';

// Every member must already be a contact of the owner. The error is
// deliberately vague: it never says who is not a contact.
export async function assertContacts(
  db: ServerDatabase,
  ownerId: string,
  memberIds: string[],
): Promise<void> {
  if (memberIds.length === 0) {
    return;
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`SELECT contact_user_id AS id FROM contacts
        WHERE user_id = ${ownerId} AND contact_user_id IN ${sql.in(memberIds)}`;
    }),
  );
  const known = new Set(rows.map((row) => row.id));
  if (memberIds.some((id) => !known.has(id))) {
    throw new HttpError(403, 'forbidden', 'All members must be your contacts');
  }
}

// A XEP-0249 direct invitation is sent after the member can already join, so
// it is best effort: a failure is logged and never fails the request.
export async function inviteNewMembers(
  adminClient: EjabberdAdminClient,
  roomLocalpart: string,
  userIds: string[],
  domain: string,
  logger: InviteLogger,
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  const users = userIds.map((userId) => jidFor(localpartFor(userId), domain));
  try {
    await adminClient.sendDirectInvitation(roomLocalpart, users);
  } catch (error) {
    logger.warn(
      { err: error, roomLocalpart, members: users.length },
      'could not send the group invitations',
    );
  }
}
