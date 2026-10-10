import { omitUndefined, ApiError, runApi } from '@zilar/api-contract';

import { API_URL } from './auth';
import type { TokenProvider } from './chat-api';
import { createApiClient } from './effect/api-client';

/**
 * Group invite links (T-0136), the mobile twin of the web client
 * (`apps/web/src/lib/api.ts`, "Group invite links" + "Join by link"): create,
 * list and revoke shareable group links for owners/admins, plus the
 * join-by-link preview and join, as a Promise port over the client derived
 * from the shared contract (`@zilar/api-contract`, `invite-links.ts`, T-0892).
 * Malformed rows fail the decode and throw `invalid_response`. The token is
 * shown once at creation in `url` and never stored: the list carries hints,
 * labels, uses and state, never tokens.
 */

export interface GroupInviteLink {
  id: string;
  label: string | null;
  tokenHint: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}

export interface CreatedInviteLink {
  id: string;
  /** The raw token, shown once. Never stored, logged or audited. */
  token: string;
  url: string;
}

export interface CreateGroupInviteLinkInput {
  label?: string;
  expiresInHours?: number;
  maxUses?: number;
}

export interface JoinPreview {
  groupTitle: string;
  memberCount: number;
  alreadyMember: boolean;
  groupId?: string;
  // T-0144: the group's kind, so the join screen reads "Join channel" for a
  // channel. Optional so older servers still parse (treated as a group).
  kind?: 'group' | 'channel';
}

export interface JoinResult {
  groupId: string;
  alreadyMember: boolean;
}

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
/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const InviteLinksApiError = ApiError;
export type InviteLinksApiError = ApiError;

/** The production `InviteLinksApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createInviteLinksApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): InviteLinksApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const links = client['invite-links'];
  return {
    // The server trims `label`; the contract encodes the trimmed form.
    createGroupInviteLink: (groupId, input = {}) =>
      runApi(
        links.createLink({
          params: { id: groupId },
          payload: {
            ...omitUndefined(input),
            ...(input.label === undefined ? {} : { label: input.label.trim() }),
          },
        }),
      ),
    listGroupInviteLinks: (groupId) =>
      runApi(links.listLinks({ params: { id: groupId } })).then(({ links: rows }) => [...rows]),
    revokeGroupInviteLink: async (groupId, linkId) => {
      await runApi(links.revokeLink({ params: { id: groupId, linkId } }));
    },
    previewJoinLink: (token) => runApi(links.preview({ params: { token } })),
    joinByLink: (token) => runApi(links.join({ params: { token } })),
  };
}

/**
 * Extracts the join token from a link the user pastes or opens. Accepts the
 * custom scheme (`zilar://join/<token>`), the web URL shape
 * (`https://host/j/<token>`), and a bare 64-hex token. Returns undefined for
 * anything else, so random clipboard text never reaches the server.
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
    // The web URL shape (`/j/<token>`, T-0115) and the mobile deep-link path
    // (`/join/<token>`): both carry a bare 64-hex token.
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
 * The neutral join failure text (T-0115): invalid, expired, revoked and full
 * links all read the same, so failures never reveal why; rate-limit answers
 * get a friendly retry text. The token must never appear in error text, so
 * callers must pass only the error code/status, never the token.
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
 * Resolves where a joined group opens: its General topic chat, else any of
 * its rows' group screen, else the chats list. Pure and UI-free (lives here
 * rather than the join view so store tests can import it without pulling in
 * `react-native`), so the route — which reads the chats fresh at call time —
 * and tests share it.
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
