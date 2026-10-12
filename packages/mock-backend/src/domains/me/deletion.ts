import type { AuthDeletionStatus } from '@zilar/api-contract';
import type { MockData } from '../../state';

// The in-memory account-deletion grace (T-1261). The row lives per backend
// instance — keyed by the `MockData` the `/me` routes see — so a `reset()`
// reseeds it, exactly like the mock sessions.
const tables = new WeakMap<MockData, { deleteAfter: string }>();

const GRACE_DAYS = 7;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

/** The viewer's grace status: scheduled with its date, or not scheduled. */
export function mockDeletionStatus(data: MockData): AuthDeletionStatus {
  const row = tables.get(data);
  return row === undefined
    ? { scheduled: false }
    : { scheduled: true, deleteAfter: row.deleteAfter };
}

/** Schedules seven days out; a second request keeps the first date. */
export function scheduleMockDeletion(data: MockData): AuthDeletionStatus {
  const existing = tables.get(data);
  if (existing !== undefined) {
    return { scheduled: true, deleteAfter: existing.deleteAfter };
  }
  const deleteAfter = new Date(Date.now() + GRACE_MS).toISOString();
  tables.set(data, { deleteAfter });
  return { scheduled: true, deleteAfter };
}

/** Cancels the request; idempotent. */
export function cancelMockDeletion(data: MockData): AuthDeletionStatus {
  tables.delete(data);
  return { scheduled: false };
}
