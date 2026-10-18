// effect-plain: the contract client runs each call; the shared chats API in @zilar/client-core owns it.
import {
  runApi,
  type AuthMe,
  type ChatEntry as ContractChatEntry,
  type Contact as ContractContact,
  type GroupAi as ContractGroupAi,
  type GroupDetail as ContractGroupDetail,
  type GroupMember as ContractGroupMember,
  type LinkPreview as ContractLinkPreview,
  type XmppTokenResult,
} from '@zilar/api-contract';
import { makeChatsApi } from '@zilar/client-core';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import type { Me } from './auth-api';

export type { Me };

/**
 * The contract client owns the transport; the shared chats API owns each call, cut to a `Promise` at the edge.
 */

export type Contact = ContractContact;

export type LinkPreview = ContractLinkPreview;

export type ChatEntry = ContractChatEntry;

export type GroupRole = 'owner' | 'admin' | 'member';

// The contract's `GroupMember.handle` is `string | null`; mobile normalizes null to absent, narrowing it back to `string | undefined`.
export type GroupMember = Omit<ContractGroupMember, 'handle'> & { handle?: string };
export type GroupDetail = Omit<ContractGroupDetail, 'members'> & { members: GroupMember[] };
export type GroupAi = ContractGroupAi;

export type XmppToken = XmppTokenResult;

export type TokenProvider = () => Promise<string | undefined>;

export interface ChatApi {
  getMe(): Promise<Me>;
  getChats(): Promise<ChatEntry[]>;
  getContacts(): Promise<Contact[]>;
  getGroup(groupId: string): Promise<GroupDetail>;
  getXmppToken(): Promise<XmppToken>;
  /** `null` when the server answers 204 or the call fails; optional so fakes keep working. */
  linkPreview?(url: string): Promise<LinkPreview | null>;
  markChatRead?(jid: string, messageId: string): Promise<void>;
  markChatDelivered?(jid: string, originIds: string[]): Promise<void>;
  /**
   * Optional so fakes keep working; the id is the archive id.
   */
  deleteMessageForMe?(jid: string, archiveId: string): Promise<void>;
  /**
   * Optional for fakes.
   */
  clearChatHistory?(jid: string): Promise<void>;
}

function toMe(me: AuthMe): Me {
  return {
    id: me.id,
    email: me.email,
    name: me.name,
    jid: me.jid ?? null,
    ...(me.bio === undefined ? {} : { bio: me.bio }),
    ...(me.avatarUrl === undefined ? {} : { avatarUrl: me.avatarUrl }),
    ...(me.timeZone === undefined ? {} : { timeZone: me.timeZone }),
  };
}

function toGroupDetail(detail: ContractGroupDetail): GroupDetail {
  return {
    ...detail,
    members: detail.members.map(({ handle, ...member }) => ({
      ...member,
      roles: member.roles ?? [],
      ...(handle === undefined || handle === null || handle === '' ? {} : { handle }),
    })),
  };
}

export function createChatApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const api = makeChatsApi((call) => runApi(call(client)));
  return {
    getMe: () => api.getMe().then(toMe),
    getChats: api.getChats,
    getContacts: api.getContacts,
    getGroup: (groupId) =>
      runApi(client.groups.detail({ params: { id: groupId } })).then(toGroupDetail),
    getXmppToken: api.getXmppToken,
    // The server answers 204 when the page has nothing; the derived client then yields `null`. A transport failure rejects, and the card treats it as `null` too.
    linkPreview: (url) =>
      runApi(client.linkPreview.get({ query: { url } })).then((value) => value ?? null),
    markChatRead: api.markChatRead,
    markChatDelivered: api.markChatDelivered,
    deleteMessageForMe: api.deleteMessageForMe,
    clearChatHistory: api.clearChatHistory,
  };
}
