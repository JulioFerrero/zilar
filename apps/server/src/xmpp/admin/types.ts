import type {
  RoomAffiliation,
  RoomAffiliationEntry,
  RosterEntry,
  RosterSubscription,
} from './schemas';

export type CreateRoomOptions = {
  title?: string;
  membersOnly?: boolean;
  persistent?: boolean;
  mam?: boolean;
  anonymous?: boolean;
  // A moderated room gives plain members the visitor role (no voice); admins and
  // owners keep voice. Channels use this; group rooms leave it off.
  moderated?: boolean;
  // With `false`, affiliated members join a moderated room as visitors.
  // Channels set it; groups and topic rooms keep ejabberd's `true`.
  membersByDefault?: boolean;
  /** MUC/Sub (XEP-0369): members can subscribe to the room for push. */
  allowSubscription?: boolean;
};

export type AddRosterItemOptions = {
  nick: string;
  groups: string[];
  subs?: RosterSubscription;
};

export type CreatedResult = { created: boolean };

export type SendDirectInvitationOptions = {
  reason?: string;
  password?: string;
};

export type UserResource = string;

export type EjabberdAdminClient = {
  registerUser(localpart: string): Promise<CreatedResult>;
  unregisterUser(localpart: string): Promise<void>;
  userExists(localpart: string): Promise<boolean>;
  // One or more entries means a session exists; pending and hibernated sessions
  // show too.
  userResources(localpart: string): Promise<UserResource[]>;
  changePassword(localpart: string, password: string): Promise<void>;
  /**
   * Ends every XMPP stream of the user. `reason` goes into a failure message
   * only; `kick_user` takes the user and host. Optional for older doubles.
   */
  kickUser?(localpart: string, reason: string): Promise<void>;
  createRoom(roomId: string, options?: CreateRoomOptions): Promise<CreatedResult>;
  setAffiliation(roomId: string, jid: string, affiliation: RoomAffiliation): Promise<void>;
  getAffiliations(roomId: string): Promise<RoomAffiliationEntry[]>;
  destroyRoom(roomId: string): Promise<void>;
  changeRoomOption(roomId: string, option: string, value: string): Promise<void>;
  subscribeRoom(roomId: string, userJid: string, nick: string): Promise<void>;
  unsubscribeRoom(roomId: string, userJid: string): Promise<void>;
  sendDirectInvitation(
    roomId: string,
    users: string[],
    options?: SendDirectInvitationOptions,
  ): Promise<void>;
  addRosterItem(
    localpart: string,
    contactJid: string,
    options: AddRosterItemOptions,
  ): Promise<void>;
  deleteRosterItem(localpart: string, contactJid: string): Promise<void>;
  getRoster(localpart: string): Promise<RosterEntry[]>;
  /** One raw stanza; both are JIDs and `to` may carry a resource. */
  sendStanza(from: string, to: string, stanza: string): Promise<void>;
};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ApiResponse = { status: number; ok: boolean; body: unknown };
