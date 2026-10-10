import { randomBytes } from 'node:crypto';
import { Exit, Schema } from 'effect';
import { JidSchema, isValid } from '@zilar/protocol';
import type { XmppConfig } from '../config';
import {
  EjabberdApiError,
  errorText,
  firstIssueMessage,
  isErrorBody,
  mentionsAlreadyExists,
} from './errors';
import {
  CheckAccountResultSchema,
  InvitationTargetsSchema,
  MutationResultSchema,
  NameSchema,
  PasswordSchema,
  RoomAffiliationEntrySchema,
  RoomAffiliationSchema,
  RoomOptionNameSchema,
  RoomOptionValueSchema,
  RosterEntrySchema,
  RosterGroupsSchema,
  RosterNickSchema,
  RosterSubscriptionSchema,
  SubscriptionNickSchema,
  type RoomAffiliation,
  type RoomAffiliationEntry,
  type RosterEntry,
} from './schemas';
import type {
  AddRosterItemOptions,
  ApiResponse,
  CreateRoomOptions,
  CreatedResult,
  EjabberdAdminClient,
  FetchLike,
  SendDirectInvitationOptions,
} from './types';

// MUC/Sub nodes a push device subscribes to: room messages only. Presence,
// affiliations and subject changes never notify.
const PUSH_SUBSCRIPTION_NODES = 'urn:xmpp:mucsub:nodes:messages';

function basicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
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
