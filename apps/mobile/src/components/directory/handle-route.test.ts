import { describe, expect, it } from 'vitest';

import { handleJoinLabel, handleRouteViewFor, postJoinTarget } from './handle-helpers';
import { DirectoryApiError } from '@/lib/directory-api';
import type { DirectoryEntry } from '@/lib/directory-api';

const ENTRY: DirectoryEntry = {
  id: 'group-hiking',
  kind: 'group',
  title: 'Hiking club',
  handle: 'hiking_club',
  description: null,
  memberCount: 42,
  joined: false,
};

// The route composes `expo-router`, the session and the store, so only the
// pure view mapping and the join label run in Node (no simulator, no new
// dependency): found renders the card, 404 (unknown and private alike) reads
// the neutral not-found line, anything else errors with Retry.
describe('handle route', () => {
  it('maps a 404 to not-found (already a member still opens)', () => {
    expect(handleRouteViewFor(new DirectoryApiError(404, 'not_found', 'gone'))).toEqual({
      state: 'not-found',
    });
    expect(handleJoinLabel({ ...ENTRY, joined: true })).toBe('Open');
  });

  it('maps other failures to the error state', () => {
    expect(handleRouteViewFor(new DirectoryApiError(429, 'rate_limited', 'slow'))).toMatchObject({
      state: 'error',
    });
    expect(handleRouteViewFor(new Error('boom'))).toMatchObject({ state: 'error' });
  });

  it('labels the join button by kind', () => {
    expect(handleJoinLabel(ENTRY)).toBe('Join the group');
    expect(handleJoinLabel({ ...ENTRY, kind: 'channel' })).toBe('Join the channel');
  });

  it('navigates to the group screen from the id, without reading the list', () => {
    // The store's chats list does not yet contain the group when the join
    // resolves (the refresh has not landed): the target still opens the
    // group screen. Only a missing id falls back to the list.
    expect(postJoinTarget('group-hiking')).toEqual({
      pathname: '/group/[id]',
      params: { id: 'group-hiking' },
    });
    expect(postJoinTarget(undefined)).toEqual({ pathname: '/' });
    expect(postJoinTarget('')).toEqual({ pathname: '/' });
  });
});
