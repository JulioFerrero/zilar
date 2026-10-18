import type { ServerDatabase } from '../db/client';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { InviteLogger } from '../groups/service';
import { errorClassName } from '../effect/error-utils';
import { HttpError, xmppUnavailable } from '../errors';
import type { RoomAffiliation } from '../xmpp/admin/schemas';
import type { TopicRow } from './access';
import { desiredMembers } from './room-members';
import { syncPushSubscriptions } from './room-push';

// effect-plain: moved unchanged from apps/server/src/topics/rooms.ts (size split)
export interface SyncTopicRoomResult {
  added: string[];
  removed: string[];
}

// Applies `desiredMembers` to the room: sets missing affiliations, invites
// newly added users, and sets `none` for anyone who should leave. Idempotent.
// Failures are logged by class name and rethrown as 502/503, so the database
// and room never disagree silently.
export async function syncTopicRoom(
  deps: TopicRoomDeps,
  topic: TopicRow,
): Promise<SyncTopicRoomResult> {
  let wanted: Map<string, RoomAffiliation>;
  try {
    wanted = await desiredMembers(deps.db, topic, deps.domain);
  } catch (error) {
    deps.logger.warn({ err: errorClassName(error) }, 'could not read the topic members');
    throw mapRoomError(error);
  }

  let current: Array<{ jid: string; affiliation: string }>;
  try {
    current = await deps.adminClient.getAffiliations(topic.roomLocalpart);
  } catch (error) {
    deps.logger.warn(
      { err: errorClassName(error), roomLocalpart: topic.roomLocalpart },
      'could not read the topic room affiliations',
    );
    throw mapRoomError(error);
  }

  const currentByJid = new Map(current.map((entry) => [entry.jid, entry.affiliation]));
  const added: string[] = [];
  const removed: string[] = [];
  for (const [jid, affiliation] of wanted) {
    if (currentByJid.get(jid) !== affiliation) {
      try {
        await deps.adminClient.setAffiliation(topic.roomLocalpart, jid, affiliation);
      } catch (error) {
        deps.logger.warn(
          { err: errorClassName(error), roomLocalpart: topic.roomLocalpart },
          'could not set the topic room affiliation',
        );
        throw mapRoomError(error);
      }
      added.push(jid);
    }
  }
  for (const [jid] of currentByJid) {
    if (!wanted.has(jid) && currentByJid.get(jid) !== 'none') {
      try {
        await deps.adminClient.setAffiliation(topic.roomLocalpart, jid, 'none');
      } catch (error) {
        deps.logger.warn(
          { err: errorClassName(error), roomLocalpart: topic.roomLocalpart },
          'could not remove the topic room affiliation',
        );
        throw mapRoomError(error);
      }
      removed.push(jid);
    }
  }

  if (added.length > 0) {
    try {
      await deps.adminClient.sendDirectInvitation(topic.roomLocalpart, added);
    } catch (error) {
      deps.logger.warn(
        { err: errorClassName(error), roomLocalpart: topic.roomLocalpart },
        'could not send the topic invitations',
      );
    }
  }
  await syncPushSubscriptions(deps, topic, wanted, currentByJid);
  return { added, removed };
}

function mapRoomError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  return xmppUnavailable();
}
export interface TopicRoomDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
}

export interface PushUserSyncDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
}

export { desiredMembers } from './room-members';

export {
  reconcileRoomSubscriptionOptions,
  syncPushSubscriptionsForUser,
  type RoomOptionsReconcileDeps,
} from './room-push';
