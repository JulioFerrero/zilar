import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { JidSchema } from '@galena/protocol';
import type { XmppConfig } from './config';

// Localparts and room ids are lowercase by design; they become part of a JID.
// They are validated before any HTTP request goes out.
const NameSchema = z
  .string()
  .regex(
    /^[a-z0-9._-]{1,64}$/,
    'must be 1-64 characters of lowercase letters, digits, ".", "_" or "-"',
  );

const PasswordSchema = z.string().min(1, 'must not be empty').max(1024);

export const RoomAffiliationSchema = z.enum(['owner', 'admin', 'member', 'none']);
export type RoomAffiliation = z.infer<typeof RoomAffiliationSchema>;

export const RosterSubscriptionSchema = z.enum(['none', 'to', 'from', 'both']);
export type RosterSubscription = z.infer<typeof RosterSubscriptionSchema>;

// A roster entry as returned by `get_roster`.
export const RosterEntrySchema = z.object({
  jid: JidSchema,
  nick: z.string(),
  subscription: RosterSubscriptionSchema,
  pending: z.string(),
  groups: z.array(z.string()),
});
export type RosterEntry = z.infer<typeof RosterEntrySchema>;

export const RoomAffiliationEntrySchema = z.object({
  jid: JidSchema,
  affiliation: z.string().min(1),
  reason: z.string(),
});
export type RoomAffiliationEntry = z.infer<typeof RoomAffiliationEntrySchema>;

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

const MutationResultSchema = z.union([z.literal(0), z.literal('')]);
const CheckAccountResultSchema = z.union([z.literal(0), z.literal(1)]);

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

function parseName(value: string, label: string): string {
  const result = NameSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `${label} "${value}" is invalid: ${result.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  return result.data;
}

function splitBareJid(value: string): { user: string; host: string } {
  const result = JidSchema.safeParse(value);
  if (!result.success) {
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
    const parsed = MutationResultSchema.safeParse(result);
    if (!parsed.success) {
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
        const parsed = z.string().safeParse(response.body);
        if (!parsed.success) {
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
      const parsed = CheckAccountResultSchema.safeParse(result);
      if (!parsed.success) {
        fail('check_account', response, `unexpected result: ${errorText(result)}`);
      }
      return parsed.data === 0;
    },

    async changePassword(localpart: string, password: string): Promise<void> {
      const user = parseName(localpart, 'localpart');
      const newpass = PasswordSchema.parse(password);
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
      } = options;
      const roomOptions = [
        { name: 'members_only', value: String(membersOnly) },
        { name: 'persistent', value: String(persistent) },
        { name: 'mam', value: String(mam) },
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
        const parsed = MutationResultSchema.safeParse(response.body);
        if (!parsed.success) {
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
      const parsedAffiliation = RoomAffiliationSchema.parse(affiliation);
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
      const parsed = z.array(RoomAffiliationEntrySchema).safeParse(result);
      if (!parsed.success) {
        fail('get_room_affiliations', response, `unexpected result: ${errorText(result)}`);
      }
      return parsed.data;
    },

    async destroyRoom(roomId: string): Promise<void> {
      const room = parseName(roomId, 'roomId');
      const response = await call('destroy_room', { room, service: config.mucDomain });
      expectMutationResult('destroy_room', response);
    },

    async sendDirectInvitation(
      roomId: string,
      users: string[],
      options: SendDirectInvitationOptions = {},
    ): Promise<void> {
      const room = parseName(roomId, 'roomId');
      const targets = z.array(JidSchema).min(1).max(1000).parse(users);
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
      const nick = z.string().max(1024).parse(options.nick);
      const groups = z.array(z.string().min(1).max(1024)).min(1).parse(options.groups);
      const subs = RosterSubscriptionSchema.parse(options.subs ?? 'both');
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
      const parsed = z.array(RosterEntrySchema).safeParse(result);
      if (!parsed.success) {
        fail('get_roster', response, `unexpected result: ${errorText(result)}`);
      }
      return parsed.data;
    },
  };
}
