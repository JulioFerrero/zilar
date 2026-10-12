import type { AuthSession } from '@zilar/api-contract';
import type { MockData } from '../../state';

// The demo sessions the mobile Devices screen lists (T-1250): this app first
// (`current`), plus one other device. Like the server's rows, these carry no
// token and no IP address. The rows live per backend instance — keyed by the
// `MockData` the `/me` routes see — so a `reset()` reseeds them.
const tables = new WeakMap<MockData, AuthSession[]>();

const SEED: readonly AuthSession[] = [
  {
    id: 'sess-mobile',
    createdAt: '2026-10-04T09:12:00.000Z',
    updatedAt: '2026-10-12T07:40:00.000Z',
    userAgent: 'Zilar/1.0 (Android 14)',
    current: true,
  },
  {
    id: 'sess-web',
    createdAt: '2026-09-20T18:03:00.000Z',
    updatedAt: '2026-10-11T21:05:00.000Z',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    current: false,
  },
];

/** The caller's sessions, seeded on first read and kept per backend. */
export function listMockSessions(data: MockData): AuthSession[] {
  const existing = tables.get(data);
  if (existing !== undefined) {
    return existing;
  }
  const seeded = SEED.map((session) => ({ ...session }));
  tables.set(data, seeded);
  return seeded;
}

/** Removes one session; answers whether it was there. */
export function revokeMockSession(data: MockData, id: string): boolean {
  const sessions = listMockSessions(data);
  const next = sessions.filter((session) => session.id !== id);
  tables.set(data, next);
  return next.length !== sessions.length;
}
