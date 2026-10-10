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
  // T-0124: a moderated room gives plain members the visitor role (no voice,
  // so they cannot post); admins/owners keep voice. Channels use this; group
  // rooms leave it off so every member can write.
  moderated?: boolean;
  // T-0124: with `membersByDefault: false`, affiliated members join a
  // moderated room as visitors (read, no voice) instead of participants.
  // Channels set this; groups and topic rooms leave it off (ejabberd's
  // default `true`), so every member keeps voice there.
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
  /** Invitation reason shown to the user, or omitted for none. */
  reason?: string;
  /** Room password, or omitted when the room has none. */
  password?: string;
};

export type EjabberdAdminClient = {
  registerUser(localpart: string): Promise<CreatedResult>;
  unregisterUser(localpart: string): Promise<void>;
  userExists(localpart: string): Promise<boolean>;
  changePassword(localpart: string, password: string): Promise<void>;
  createRoom(roomId: string, options?: CreateRoomOptions): Promise<CreatedResult>;
  setAffiliation(roomId: string, jid: string, affiliation: RoomAffiliation): Promise<void>;
  getAffiliations(roomId: string): Promise<RoomAffiliationEntry[]>;
  destroyRoom(roomId: string): Promise<void>;
  /** Changes one MUC room option (for example `allow_subscription`). */
  changeRoomOption(roomId: string, option: string, value: string): Promise<void>;
  /** Subscribes a user to a MUC/Sub room (XEP-0369) for push delivery. */
  subscribeRoom(roomId: string, userJid: string, nick: string): Promise<void>;
  /** Removes a MUC/Sub room subscription again. */
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
};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ApiResponse = { status: number; ok: boolean; body: unknown };
