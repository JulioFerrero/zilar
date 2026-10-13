import { describe, expect, it } from 'vitest';

import { avatarIdentity } from './avatar-identity';

describe('avatarIdentity', () => {
  it('seeds a person by the normalized name and keeps the picture', () => {
    expect(
      avatarIdentity({ name: '  Ana  María ', userId: 'u1', avatarUrl: 'https://x/a.png' }),
    ).toEqual({ name: 'Ana  María', seed: 'ana maría', avatarUrl: 'https://x/a.png' });
  });

  it('reads a handle lookup image as the picture', () => {
    expect(avatarIdentity({ name: 'Ana', userId: 'u1', image: 'https://x/a.png' })).toEqual({
      name: 'Ana',
      seed: 'ana',
      avatarUrl: 'https://x/a.png',
    });
  });

  it('seeds a chat row by its title', () => {
    expect(avatarIdentity({ id: 'c1', title: 'Dev Team' })).toEqual({
      name: 'Dev Team',
      seed: 'dev team',
    });
  });

  it('seeds a group header by the group title, not the topic title under it', () => {
    // `GroupHeaderRow` hands the General topic row with the group title swapped
    // in (T-1334); every group's header must not fall back to "General".
    expect(avatarIdentity({ id: 'general@alpha', title: 'Alpha' }).seed).toBe('alpha');
  });

  it('falls back to the id when the name is empty', () => {
    expect(avatarIdentity({ name: '   ', userId: 'ana@zilar.test' })).toEqual({
      name: 'ana@zilar.test',
      seed: 'ana@zilar.test',
    });
  });
});
