export {
  RoomAffiliationEntrySchema,
  RoomAffiliationSchema,
  RosterEntrySchema,
  RosterSubscriptionSchema,
} from './admin/schemas';
export type {
  RoomAffiliation,
  RoomAffiliationEntry,
  RosterEntry,
  RosterSubscription,
} from './admin/schemas';
export type {
  AddRosterItemOptions,
  CreateRoomOptions,
  CreatedResult,
  EjabberdAdminClient,
  FetchLike,
  SendDirectInvitationOptions,
  UserResource,
} from './admin/types';
export { EjabberdApiError } from './admin/errors';
export { createEjabberdAdminClient } from './admin/client';
