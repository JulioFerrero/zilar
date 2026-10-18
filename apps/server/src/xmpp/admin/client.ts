import { randomBytes } from 'node:crypto';
import { Exit, Schema } from 'effect';
import type { XmppConfig } from '../config';
import { errorText, isErrorBody, mentionsAlreadyExists } from './errors';
import { parseJid, parseName, splitBareJid } from './names';
import { createAdminTransport } from './transport';
import {
  CheckAccountResultSchema,
  InvitationTargetsSchema,
  MutationResultSchema,
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
  CreateRoomOptions,
  CreatedResult,
  EjabberdAdminClient,
  FetchLike,
  SendDirectInvitationOptions,
  UserResource,
} from './types';

// MUC/Sub nodes a push device subscribes to: room messages only. Presence,
// affiliations and subject changes never notify.
const PUSH_SUBSCRIPTION_NODES = 'urn:xmpp:mucsub:nodes:messages';

export function createEjabberdAdminClient(
  config: XmppConfig,
  fetchImpl: FetchLike = fetch,
): EjabberdAdminClient {
  const transport = createAdminTransport(config, fetchImpl);
  const { call, expectOk, expectMutationResult } = transport;
  // `typeof` keeps `fail`'s `never` return type, so the methods' control flow
  // still narrows after an `if (Exit.isFailure(...)) fail(...)`.
  const fail: typeof transport.fail = transport.fail;

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

    // The sessions ejabberd holds for the user, as resource strings (the
    // command answers `[resource...]`; an offline user answers `[]`). A
    // non-empty list only says "a session exists": pending and hibernated
    // sessions show too, and those are the ones ejabberd itself pushes.
    async userResources(localpart: string): Promise<UserResource[]> {
      const user = parseName(localpart, 'localpart');
      const response = await call('user_resources', { user, host: config.domain });
      const result = expectOk('user_resources', response);
      const parsed = Schema.decodeUnknownExit(Schema.mutable(Schema.Array(Schema.String)))(result);
      if (Exit.isFailure(parsed)) {
        fail('user_resources', response, `unexpected result: ${errorText(result)}`);
      }
      return parsed.value;
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

    // T-1982: revoking or signing out a device ends all of the user's XMPP
    // streams, so a revoked device stops receiving at once. The other devices
    // reconnect with fresh tokens, so they only blip.
    //
    // ejabberd answers a raw result string such as `Kicked sessions: 2`; an
    // offline user answers `Kicked sessions: 0`, which is success. A number is
    // tolerated for older builds. Anything else is a failure the caller logs
    // and ignores.
    async kickUser(localpart: string, reason: string): Promise<void> {
      const user = parseName(localpart, 'localpart');
      const response = await call('kick_user', { user, host: config.domain });
      const result = expectOk('kick_user', response);
      const parsed = Schema.decodeUnknownExit(Schema.Union([Schema.String, Schema.Number]))(result);
      if (Exit.isFailure(parsed)) {
        fail('kick_user', response, `${reason}: unexpected result: ${errorText(result)}`);
      }
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

    // One raw stanza, used for the live delivered notice (T-1245). `from` and
    // `to` may be full JIDs; its answer is the same rescode as the other
    // mutations (`mod_admin_extra` `send_stanza`, `result = {res, rescode}`).
    async sendStanza(from: string, to: string, stanza: string): Promise<void> {
      const sendFrom = parseJid(from, 'from');
      const sendTo = parseJid(to, 'to');
      const response = await call('send_stanza', { from: sendFrom, to: sendTo, stanza });
      expectMutationResult('send_stanza', response);
    },
  };
}
