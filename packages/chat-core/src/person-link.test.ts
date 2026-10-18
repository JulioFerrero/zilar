import { describe, expect, it } from 'vitest';

import { resolvePerson, type PersonLinkContext } from './person-link';

const CURRENT_USER = 'user-me';

function context(overrides: Partial<PersonLinkContext> = {}): PersonLinkContext {
  return {
    contacts: [{ jid: 'ana@zilar.test', userId: 'user-ana' }],
    chats: [
      { id: 'boa@zilar.test', kind: 'dm' },
      { id: 'room@conference.zilar.test', kind: 'group' },
    ],
    currentUserId: CURRENT_USER,
    ...overrides,
  };
}

describe('resolvePerson', () => {
  it('opens nothing for yourself by a mixed-case user id', () => {
    expect(
      resolvePerson(
        { userId: 'User-Me' },
        context({ contacts: [{ jid: 'me@zilar.test', userId: 'user-me' }] }),
      ),
    ).toBeUndefined();
  });

  it('opens nothing for yourself by JID', () => {
    expect(
      resolvePerson(
        { jid: 'USER-ME@zilar.test' },
        context({ chats: [{ id: 'user-me@zilar.test', kind: 'dm' }] }),
      ),
    ).toBeUndefined();
  });

  it('opens the contact DM for a mixed-case user id', () => {
    expect(resolvePerson({ userId: 'User-Ana' }, context())).toEqual({
      kind: 'contact',
      chatId: 'ana@zilar.test',
    });
  });

  it('opens a DM chat by JID', () => {
    expect(resolvePerson({ jid: 'Boa@zilar.test' }, context())).toEqual({
      kind: 'chat',
      chatId: 'boa@zilar.test',
    });
  });

  it('never matches a group chat by JID', () => {
    expect(resolvePerson({ jid: 'room@conference.zilar.test' }, context())).toBeUndefined();
  });

  it('opens the profile of a full occupant JID that carries a handle', () => {
    expect(
      resolvePerson({ jid: 'room@conference.zilar.test/nick', handle: 'ana' }, context()),
    ).toEqual({ kind: 'profile', handle: 'ana' });
  });

  it('falls back to a group member handle for an unknown JID', () => {
    expect(
      resolvePerson(
        { jid: 'cleo@zilar.test' },
        context({ memberHandle: (localpart) => (localpart === 'cleo' ? 'cleo' : undefined) }),
      ),
    ).toEqual({ kind: 'profile', handle: 'cleo' });
  });

  it('opens nothing for an unknown person', () => {
    expect(resolvePerson({ jid: 'nobody@zilar.test' }, context())).toBeUndefined();
  });
});
