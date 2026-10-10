// Shared handle and directory helpers for the contact-requests, blocks and
// handles domains, mirroring web's mock (`apps/web/src/mock/api.ts:1081-1196`).
// The handle rules come from `@zilar/protocol`; the always-taken `taken_user`
// resolves to the seed's Ana and every other valid free handle to a synthetic
// stranger. Reserved words and malformed shapes stay invisible (null/404).

import type { HandleCheck, HandleProfile } from '@zilar/api-contract';
import { RESERVED_HANDLES } from '@zilar/protocol';
import { currentUser } from '../../data/people';
import type { MockData } from '../../state';

const HANDLE_PATTERN = /^[a-z][a-z0-9_]{2,31}$/;
const TAKEN_HANDLE = 'taken_user';
const ANA_JID = 'ana@zilar.test';

/** Live availability for a typed handle, like web's `mockCheckHandle`. */
export function checkHandle(raw: string): HandleCheck {
  const trimmed = raw.trim();
  const normalized = trimmed.toLowerCase();
  if (RESERVED_HANDLES.has(normalized)) {
    return { available: false, reason: 'reserved' };
  }
  if (!HANDLE_PATTERN.test(trimmed)) {
    return { available: false, reason: 'invalid' };
  }
  if (normalized === TAKEN_HANDLE) {
    return { available: false, reason: 'taken' };
  }
  return { available: true };
}

/** The user id a typed handle resolves to, or `null` when it is reserved or malformed. */
export function handleUserId(data: MockData, raw: string): string | null {
  const trimmed = raw.trim().replace(/^@/, '');
  const normalized = trimmed.toLowerCase();
  if (RESERVED_HANDLES.has(normalized)) {
    return null;
  }
  if (!HANDLE_PATTERN.test(trimmed)) {
    return null;
  }
  if (normalized === TAKEN_HANDLE) {
    return anaId(data) ?? null;
  }
  return `u-handle-${normalized}`;
}

/** The by-handle profile with its relation, like web's `mockHandleProfile`. */
export function handleProfile(data: MockData, raw: string): HandleProfile | null {
  const userId = handleUserId(data, raw);
  if (userId === null) {
    return null;
  }
  const trimmed = raw.trim().replace(/^@/, '');
  const person = data.people.find((entry) => entry.id === userId);
  const name = person?.name ?? displayNameForHandle(trimmed);
  if (userId === currentUser.id) {
    return { userId, name, handle: trimmed, image: null, relation: 'self' };
  }
  if (data.isBlocked(userId)) {
    return { userId, name, handle: trimmed, image: null, relation: 'blocked' };
  }
  const outgoing = data.contactRequests.find(
    (row) =>
      row.status === 'pending' && row.fromUserId === currentUser.id && row.toUserId === userId,
  );
  const incoming = data.contactRequests.find(
    (row) =>
      row.status === 'pending' && row.fromUserId === userId && row.toUserId === currentUser.id,
  );
  return {
    userId,
    name,
    handle: trimmed,
    image: null,
    relation:
      outgoing !== undefined
        ? 'request_sent'
        : incoming !== undefined
          ? 'request_received'
          : 'none',
  };
}

/** The handle a known seed person is reachable under (Ana owns the taken one). */
export function personHandle(data: MockData, userId: string): string | null {
  if (userId === anaId(data)) {
    return TAKEN_HANDLE;
  }
  const person = data.people.find((entry) => entry.id === userId);
  if (person === undefined) {
    return null;
  }
  return person.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
}

/** The name/handle of a synthetic `u-handle-<name>` stranger, or `null` for a real id. */
export function handleProfileForId(userId: string): { name: string; handle: string } | null {
  if (userId.startsWith('u-handle-')) {
    const handle = userId.slice('u-handle-'.length);
    return { name: displayNameForHandle(handle), handle };
  }
  return null;
}

function anaId(data: MockData): string | undefined {
  return data.people.find((person) => person.jid === ANA_JID)?.id;
}

function displayNameForHandle(handle: string): string {
  return handle.charAt(0).toUpperCase() + handle.slice(1).replace(/_/g, ' ');
}
