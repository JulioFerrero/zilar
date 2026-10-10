// The ejabberd admin client used to live in this file. It is split into
// `admin/schemas.ts` (the schemas and their inferred types), `admin/types.ts`
// (the option and client types), `admin/errors.ts` (the error type and its
// helpers) and `admin/client.ts` (the HTTP client itself). This path stays a
// barrel so every importer keeps working with the same names and kinds.

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
} from './admin/types';
export { EjabberdApiError } from './admin/errors';
export { createEjabberdAdminClient } from './admin/client';
