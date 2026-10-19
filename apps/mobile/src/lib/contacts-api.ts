import { bareJid } from '@zilar/protocol';
import { makeContactsApi, type HandleProfile } from '@zilar/client-core';
import type { ApiCall } from './effect/api-client';
/** Errors are the shared `ApiError`: screens branch on `code` and `status` (404 unknown handle, 429 rate limited). */

export type ContactsApi = Omit<ReturnType<typeof makeContactsApi>, 'searchUsers'> & {
  searchUsers(q: string): Promise<HandleProfile[]>;
};

/** The server compares case-insensitively, so the lookup sends the trimmed, lowercased form without a leading @. */
export function normalizeHandleInput(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

/** The domain part of a bare user JID, or undefined for anything else. */
export function domainOfJid(jid: string | null | undefined): string | undefined {
  if (typeof jid !== 'string') return undefined;
  const bare = bareJid(jid);
  const parts = bare.split('@');
  if (parts.length !== 2) return undefined;
  const domain = parts[1] ?? '';
  return domain === '' ? undefined : domain;
}

/** Lowercased id plus the XMPP domain; an id needing the hash fallback resolves to a chat that does not exist. */
export function contactChatId(userId: string, domain: string): string {
  return `${userId.toLowerCase()}@${domain}`;
}

export function makePhoneContactsApi(call: ApiCall): ContactsApi {
  const api = makeContactsApi(call);
  return { ...api, searchUsers: (q) => api.searchUsers(q).then(({ entries }) => [...entries]) };
}
