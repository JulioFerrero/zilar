import { describe, expect, it } from 'vitest';

import {
  describeDirectoryError,
  describeJoinError,
  directorySubtitle,
  exploreActionTitle,
} from './explore-helpers';
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

describe('explore-helpers', () => {
  it('names the 429 as a wait-and-retry line', () => {
    expect(
      describeDirectoryError(new DirectoryApiError(429, 'rate_limited', 'Slow down'), 'fallback'),
    ).toBe('Too many searches, try again in a few minutes');
  });

  it('never renders raw server text', () => {
    const rendered = describeDirectoryError(
      new DirectoryApiError(500, 'internal', 'db timeout on shard 3'),
      'Could not load the directory. Try again.',
    );
    expect(rendered).toBe('Could not load the directory. Try again.');
    expect(rendered).not.toContain('shard');
  });

  it('maps join failures without raw server text', () => {
    expect(describeJoinError(new DirectoryApiError(409, 'group_full', 'full'))).toBe(
      'That group is full right now.',
    );
    expect(describeJoinError(new DirectoryApiError(404, 'not_found', 'gone'))).toBe(
      'That group is no longer public.',
    );
    expect(describeJoinError(new DirectoryApiError(0, 'network_error', 'down'))).toContain(
      'Could not reach the server',
    );
    expect(describeJoinError(new Error('boom'))).toBe('Could not join. Try again.');
  });

  it('renders the subtitle and the Join / Open button', () => {
    expect(directorySubtitle(ENTRY)).toBe('42 members');
    expect(directorySubtitle({ ...ENTRY, memberCount: 1 })).toBe('1 member');
    expect(directorySubtitle({ ...ENTRY, kind: 'channel' })).toBe('42 members · Channel');
    expect(exploreActionTitle(ENTRY)).toBe('Join');
    expect(exploreActionTitle({ ...ENTRY, joined: true })).toBe('Open');
  });
});
