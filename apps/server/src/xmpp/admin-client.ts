import { randomBytes } from 'node:crypto';
import { Exit, Schema, SchemaIssue } from 'effect';
import { JidSchema, isJid, isValid, struct } from '@zilar/protocol';
import type { XmppConfig } from './config';

// Localparts and room ids are lowercase by design; they become part of a JID.
// They are validated before any HTTP request goes out.
const NameSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value: string) =>
      /^[a-z0-9._-]{1,64}$/.test(value)
        ? undefined
        : 'must be 1-64 characters of lowercase letters, digits, ".", "_" or "-"',
    ),
  ),
);

const PasswordSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value: string) => (value.length >= 1 ? undefined : 'must not be empty')),
    Schema.isMaxLength(1024),
  ),
);

// The shared protocol rule, re-checked here; `isJid` is the same rule the
// protocol package applies to `JidSchema`.
const BareJidSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value: string) =>
      isJid(value) ? undefined : 'must be a bare JID (local@domain)',
    ),
  ),
);

// MUC/Sub nodes a push device subscribes to: room messages only. Presence,
// affiliations and subject changes never notify.
const PUSH_SUBSCRIPTION_NODES = 'urn:xmpp:mucsub:nodes:messages';

export const RoomAffiliationSchema = Schema.Literals(['owner', 'admin', 'member', 'none']);
export type RoomAffiliation = Schema.Schema.Type<typeof RoomAffiliationSchema>;

export const RosterSubscriptionSchema = Schema.Literals(['none', 'to', 'from', 'both']);
export type RosterSubscription = Schema.Schema.Type<typeof RosterSubscriptionSchema>;

// A roster entry as returned by `get_roster`.
export const RosterEntrySchema = struct({
  jid: BareJidSchema,
  nick: Schema.String,
  subscription: RosterSubscriptionSchema,
  pending: Schema.String,
  groups: Schema.mutable(Schema.Array(Schema.String)),
});
export type RosterEntry = Schema.Schema.Type<typeof RosterEntrySchema>;

export const RoomAffiliationEntrySchema = struct({
  jid: BareJidSchema,
  affiliation: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  reason: Schema.String,
});
export type RoomAffiliationEntry = Schema.Schema.Type<typeof RoomAffiliationEntrySchema>;

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

// Every failure coming from ejabberd (HTTP status or an error body) is wrapped
// in this type. Messages never include the admin credentials.
export class EjabberdApiError extends Error {
  readonly command: string;
  readonly status: number;

  constructor(command: string, status: number, detail: string) {
    super(`ejabberd command "${command}" failed with HTTP ${status}: ${detail}`);
    this.name = 'EjabberdApiError';
    this.command = command;
    this.status = status;
  }
}

type ApiResponse = { status: number; ok: boolean; body: unknown };

const MutationResultSchema = Schema.Union([Schema.Literal(0), Schema.Literal('')]);
const CheckAccountResultSchema = Schema.Union([Schema.Literal(0), Schema.Literal(1)]);

const RoomOptionNameSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
);
const RoomOptionValueSchema = Schema.String.pipe(Schema.check(Schema.isMaxLength(4096)));
const SubscriptionNickSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
);
const RosterNickSchema = Schema.String.pipe(Schema.check(Schema.isMaxLength(1024)));
const RosterGroupSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
);
const RosterGroupsSchema = Schema.Array(RosterGroupSchema).check(Schema.isMinLength(1));
const InvitationTargetsSchema = Schema.Array(BareJidSchema).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1000),
);

function basicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}

// ejabberd answers errors either as a bare JSON string ("Room already exists")
// or as `{ "status": "error", "code": …, "message": … }`. This extracts a
// readable detail from both.
function errorText(body: unknown): string {
  if (typeof body === 'string') {
    return body === '' ? 'no response body' : body;
  }
  if (body === null) {
    return 'no response body';
  }
  if (typeof body === 'object') {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  try {
    return JSON.stringify(body);
  } catch {
    return 'unreadable response body';
  }
}

function isErrorBody(body: unknown): boolean {
  if (body === null || typeof body !== 'object') {
    return false;
  }
  const record = body as Record<string, unknown>;
  return record['status'] === 'error' || typeof record['error'] === 'string';
}

function mentionsAlreadyExists(body: unknown): boolean {
  const text = errorText(body).toLowerCase();
  return text.includes('already registered') || text.includes('already exists');
}

function firstIssueMessage(issue: SchemaIssue.Issue): string | undefined {
  switch (issue._tag) {
    case 'Composite':
    case 'AnyOf':
      for (const child of issue.issues) {
        const message = firstIssueMessage(child);
        if (message !== undefined) {
          return message;
        }
      }
      return undefined;
    case 'Pointer':
    case 'Filter':
    case 'Encoding':
      return firstIssueMessage(issue.issue);
    case 'InvalidValue': {
      const message = issue.annotations?.message;
      return typeof message === 'string' && message.length > 0 ? message : undefined;
    }
    default:
      return undefined;
  }
}

function parseName(value: string, label: string): string {
  const exit = Schema.decodeUnknownExit(NameSchema)(value);
  if (Exit.isFailure(exit)) {
    let message: string | undefined;
    for (const reason of exit.cause.reasons) {
      if (reason._tag === 'Fail') {
        message = firstIssueMessage(reason.error.issue);
        break;
      }
    }
    throw new Error(`${label} "${value}" is invalid: ${message ?? 'invalid'}`);
  }
  return exit.value;
}

function splitBareJid(value: string): { user: string; host: string } {
  if (!isValid(JidSchema)(value)) {
    throw new Error(`jid "${value}" is invalid`);
  }
  const at = value.indexOf('@');
  return { user: value.slice(0, at), host: value.slice(at + 1) };
}

export function createEjabberdAdminClient(
  config: XmppConfig,
  fetchImpl: FetchLike = fetch,
): EjabberdAdminClient {
  async function call(command: string, body: Record<string, unknown>): Promise<ApiResponse> {
    const response = await fetchImpl(`${config.apiUrl}/${command}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(config.adminJid, config.adminPassword),
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, ok: response.ok, body: parsed };
  }

  function fail(command: string, response: ApiResponse, detail?: string): never {
    throw new EjabberdApiError(command, response.status, detail ?? errorText(response.body));
  }

  function expectOk(command: string, response: ApiResponse): unknown {
    if (!response.ok || isErrorBody(response.body)) {
      fail(command, response);
    }
    return response.body;
  }

  function expectMutationResult(command: string, response: ApiResponse): void {
    const result = expectOk(command, response);
    const parsed = Schema.decodeUnknownExit(MutationResultSchema)(result);
    if (Exit.isFailure(parsed)) {
      fail(command, response, `unexpected result: ${errorText(result)}`);
    }
  }

  return {
    async registerUser(localpart: string): Promise<CreatedResult> {
      const user = parseName(localpart, 'localpart');
      const response = await call('register', {
        user,
        host: config.domain,
        password: randomBytes(32).toString('base64url'),
      });
      if (response.ok && !isErrorBody(response.body)) {
        const parsed = Schema.decodeUnknownExit(Schema.String)(response.body);
        if (Exit.isFailure(parsed)) {
          fail('register', response, `unexpected result: ${errorText(response.body)}`);
        }
        return { created: true };
      }
      if (mentionsAlreadyExists(response.body)) {
        return { created: false };
      }
      return fail('register', response);
    },

    async unregisterUser(localpart: string): Promise<void> {
      const user = parseName(localpart, 'localpart');
      const response = await call('unregister', { user, host: config.domain });
      expectMutationResult('unregister', response);
    },

    async userExists(localpart: string): Promise<boolean> {
      const user = parseName(localpart, 'localpart');
      const response = await call('check_account', { user, host: config.domain });
      const result = expectOk('check_account', response);
      const parsed = Schema.decodeUnknownExit(CheckAccountResultSchema)(result);
      if (Exit.isFailure(parsed)) {
        fail('check_account', response, `unexpected result: ${errorText(result)}`);
      }
      return parsed.value === 0;
    },

    async changePassword(localpart: string, password: string): Promise<void> {
      const user = parseName(localpart, 'localpart');
      const newpass = Schema.decodeUnknownSync(PasswordSchema)(password);
      const response = await call('change_password', {
        user,
        host: config.domain,
        newpass,
      });
      expectMutationResult('change_password', response);
    },

    async createRoom(roomId: string, options: CreateRoomOptions = {}): Promise<CreatedResult> {
      const room = parseName(roomId, 'roomId');
      const {
        title,
        membersOnly = true,
        persistent = true,
        mam = true,
        anonymous,
        moderated,
        membersByDefault,
        allowSubscription = true,
      } = options;
      const roomOptions = [
        { name: 'members_only', value: String(membersOnly) },
        { name: 'persistent', value: String(persistent) },
        { name: 'mam', value: String(mam) },
        // Push (T-0119): every room allows MUC/Sub subscriptions so members
        // with a push device can subscribe for offline notifications.
        { name: 'allow_subscription', value: String(allowSubscription) },
      ];
      if (anonymous !== undefined) {
        roomOptions.push({ name: 'anonymous', value: String(anonymous) });
      }
      if (moderated !== undefined) {
        roomOptions.push({ name: 'moderated', value: String(moderated) });
      }
      if (membersByDefault !== undefined) {
        roomOptions.push({ name: 'members_by_default', value: String(membersByDefault) });
      }
      if (title !== undefined) {
        roomOptions.push({ name: 'title', value: title });
      }
      const response = await call('create_room_with_opts', {
        room,
        service: config.mucDomain,
        host: config.domain,
        options: roomOptions,
      });
      if (response.ok && !isErrorBody(response.body)) {
        const parsed = Schema.decodeUnknownExit(MutationResultSchema)(response.body);
        if (Exit.isFailure(parsed)) {
          fail('create_room_with_opts', response, `unexpected result: ${errorText(response.body)}`);
        }
        return { created: true };
      }
      if (mentionsAlreadyExists(response.body)) {
        return { created: false };
      }
      return fail('create_room_with_opts', response);
    },

    async setAffiliation(roomId: string, jid: string, affiliation: RoomAffiliation): Promise<void> {
      const room = parseName(roomId, 'roomId');
      const { user, host } = splitBareJid(jid);
      const parsedAffiliation = Schema.decodeUnknownSync(RoomAffiliationSchema)(affiliation);
      const response = await call('set_room_affiliation', {
        room,
        service: config.mucDomain,
        user,
        host,
        affiliation: parsedAffiliation,
      });
      expectMutationResult('set_room_affiliation', response);
    },

    async getAffiliations(roomId: string): Promise<RoomAffiliationEntry[]> {
      const room = parseName(roomId, 'roomId');
      const response = await call('get_room_affiliations', {
        room,
        service: config.mucDomain,
      });
      const result = expectOk('get_room_affiliations', response);
      const parsed = Schema.decodeUnknownExit(
        Schema.mutable(Schema.Array(RoomAffiliationEntrySchema)),
      )(result);
      if (Exit.isFailure(parsed)) {
        fail('get_room_affiliations', response, `unexpected result: ${errorText(result)}`);
      }
      return parsed.value;
    },

    async destroyRoom(roomId: string): Promise<void> {
      const room = parseName(roomId, 'roomId');
      const response = await call('destroy_room', { room, service: config.mucDomain });
      expectMutationResult('destroy_room', response);
    },

    async changeRoomOption(roomId: string, option: string, value: string): Promise<void> {
      const room = parseName(roomId, 'roomId');
      const optionName = Schema.decodeUnknownSync(RoomOptionNameSchema)(option);
      const optionValue = Schema.decodeUnknownSync(RoomOptionValueSchema)(value);
      const response = await call('change_room_option', {
        name: room,
        service: config.mucDomain,
        option: optionName,
        value: optionValue,
      });
      expectMutationResult('change_room_option', response);
    },

    async subscribeRoom(roomId: string, userJid: string, nick: string): Promise<void> {
      const room = parseName(roomId, 'roomId');
      const { user, host } = splitBareJid(userJid);
      const subscriptionNick = Schema.decodeUnknownSync(SubscriptionNickSchema)(nick);
      const response = await call('subscribe_room', {
        user,
        host,
        nick: subscriptionNick,
        room,
        service: config.mucDomain,
        nodes: PUSH_SUBSCRIPTION_NODES,
      });
      // The command answers the subscribed node list, not a status code.
      const result = expectOk('subscribe_room', response);
      const parsed = Schema.decodeUnknownExit(Schema.Array(Schema.String))(result);
      if (Exit.isFailure(parsed)) {
        fail('subscribe_room', response, `unexpected result: ${errorText(result)}`);
      }
    },

    async unsubscribeRoom(roomId: string, userJid: string): Promise<void> {
      const room = parseName(roomId, 'roomId');
      const { user, host } = splitBareJid(userJid);
      const response = await call('unsubscribe_room', {
        user,
        host,
        room,
        service: config.mucDomain,
      });
      expectMutationResult('unsubscribe_room', response);
    },

    async sendDirectInvitation(
      roomId: string,
      users: string[],
      options: SendDirectInvitationOptions = {},
    ): Promise<void> {
      const room = parseName(roomId, 'roomId');
      const targets = Schema.decodeUnknownSync(InvitationTargetsSchema)(users);
      const response = await call('send_direct_invitation', {
        room,
        service: config.mucDomain,
        password: options.password ?? 'none',
        reason: options.reason ?? 'none',
        users: targets,
      });
      expectMutationResult('send_direct_invitation', response);
    },

    async addRosterItem(
      localpart: string,
      contactJid: string,
      options: AddRosterItemOptions,
    ): Promise<void> {
      const localuser = parseName(localpart, 'localpart');
      const { user, host } = splitBareJid(contactJid);
      const nick = Schema.decodeUnknownSync(RosterNickSchema)(options.nick);
      const groups = Schema.decodeUnknownSync(RosterGroupsSchema)(options.groups);
      const subs = Schema.decodeUnknownSync(RosterSubscriptionSchema)(options.subs ?? 'both');
      const response = await call('add_rosteritem', {
        localuser,
        localhost: config.domain,
        user,
        host,
        nick,
        groups,
        subs,
      });
      expectMutationResult('add_rosteritem', response);
    },

    async deleteRosterItem(localpart: string, contactJid: string): Promise<void> {
      const localuser = parseName(localpart, 'localpart');
      const { user, host } = splitBareJid(contactJid);
      const response = await call('delete_rosteritem', {
        localuser,
        localhost: config.domain,
        user,
        host,
      });
      expectMutationResult('delete_rosteritem', response);
    },

    async getRoster(localpart: string): Promise<RosterEntry[]> {
      const user = parseName(localpart, 'localpart');
      const response = await call('get_roster', { user, host: config.domain });
      const result = expectOk('get_roster', response);
      const parsed = Schema.decodeUnknownExit(Schema.mutable(Schema.Array(RosterEntrySchema)))(
        result,
      );
      if (Exit.isFailure(parsed)) {
        fail('get_roster', response, `unexpected result: ${errorText(result)}`);
      }
      return parsed.value;
    },
  };
}
