import {
  ApiError,
  runApi,
  type CreatedInviteLink,
  type InviteLink as GroupInviteLink,
  type JoinPreview,
  type JoinResult,
} from '@zilar/api-contract';
import { makeGroupsApi, type CreateGroupInviteLinkInput } from '@zilar/client-core';

import { API_URL } from './auth';
import type { TokenProvider } from './chat-api';
import { createApiClient } from './effect/api-client';

/**
 * The token is shown once at creation in `url` and never stored, so the list carries hints, labels, uses and state, never tokens.
 */

export type {
  CreatedInviteLink,
  InviteLink as GroupInviteLink,
  JoinPreview,
  JoinResult,
} from '@zilar/api-contract';
// Absent on older servers, where every link is a group.
export type { CreateGroupInviteLinkInput };

export interface InviteLinksApi {
  createGroupInviteLink(
    groupId: string,
    input?: CreateGroupInviteLinkInput,
  ): Promise<CreatedInviteLink>;
  listGroupInviteLinks(groupId: string): Promise<GroupInviteLink[]>;
  revokeGroupInviteLink(groupId: string, linkId: string): Promise<void>;
  previewJoinLink(token: string): Promise<JoinPreview>;
  joinByLink(token: string): Promise<JoinResult>;
}
export const InviteLinksApiError = ApiError;
export type InviteLinksApiError = ApiError;

export function createInviteLinksApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): InviteLinksApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const api = makeGroupsApi((call) => runApi(call(client)));
  return {
    createGroupInviteLink: api.createGroupInviteLink,
    listGroupInviteLinks: api.listGroupInviteLinks,
    revokeGroupInviteLink: (groupId, linkId) =>
      api.revokeGroupInviteLink(groupId, linkId).then(() => undefined),
    previewJoinLink: api.previewJoinLink,
    joinByLink: api.joinByLink,
  };
}

/**
 * Accepts `zilar://join/<token>`, `https://host/j/<token>` and a bare 64-hex token; anything else gives undefined, so random clipboard text never reaches the server.
 */
export function extractJoinToken(raw: string): string | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  if (/^[0-9a-f]{64}$/i.test(text)) {
    return text.toLowerCase();
  }
  let parsed: URL | undefined;
  try {
    parsed = new URL(text);
  } catch {
    return undefined;
  }
  if (parsed.protocol === 'zilar:' && parsed.hostname.toLowerCase() === 'join') {
    const token = parsed.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
    return /^[0-9a-f]{64}$/i.test(token) ? token.toLowerCase() : undefined;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
    // The web `/j/<token>` and the mobile `/join/<token>` both carry a bare 64-hex token.
    if (
      segments.length === 2 &&
      (segments[0]?.toLowerCase() === 'j' || segments[0]?.toLowerCase() === 'join')
    ) {
      const token = segments[1] ?? '';
      return /^[0-9a-f]{64}$/i.test(token) ? token.toLowerCase() : undefined;
    }
  }
  return undefined;
}

const INVITE_LINK_FAILURE_MESSAGE = 'This link does not work';
const INVITE_LINK_RETRY_MESSAGE = 'Too many attempts. Try again later.';
/**
 * Invalid, expired, revoked and full links all read the same, so failures never reveal why; the token must never appear in error text, so callers pass only code/status.
 */
export function joinFailureMessage(error: { status: number; code: string }): string {
  if (error.status === 429 || error.code === 'rate_limited') {
    return INVITE_LINK_RETRY_MESSAGE;
  }
  return INVITE_LINK_FAILURE_MESSAGE;
}

export type GroupChatTarget =
  { kind: 'chat'; chatId: string } | { kind: 'group'; groupId: string } | { kind: 'list' };

/**
 * Pure and UI-free, so the route (which reads the chats fresh at call time) and tests share it.
 */
export function resolveGroupChat(
  chats: { id: string; groupId?: string; topic?: { isGeneral?: boolean } }[],
  groupId: string,
): GroupChatTarget {
  const general = chats.find((chat) => chat.groupId === groupId && chat.topic?.isGeneral === true);
  if (general !== undefined) {
    return { kind: 'chat', chatId: general.id };
  }
  if (chats.some((chat) => chat.groupId === groupId)) {
    return { kind: 'group', groupId };
  }
  return { kind: 'list' };
}
