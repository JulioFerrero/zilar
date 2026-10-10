import type { ServerDatabase } from '../db/client';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { InviteLogger } from '../groups/service';

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
export { syncTopicRoom, type SyncTopicRoomResult } from './room-sync';
export {
  reconcileRoomSubscriptionOptions,
  syncPushSubscriptionsForUser,
  type RoomOptionsReconcileDeps,
} from './room-push';
