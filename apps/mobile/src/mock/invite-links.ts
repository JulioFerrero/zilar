import type {
  CreatedInviteLink,
  GroupInviteLink,
  JoinPreview,
  JoinResult,
} from '../lib/invite-links-api';

/**
 * The mock invite-links backend (T-0136): one in-memory link store per mock
 * store, covering create, list, revoke, preview and join. The tokens are
 * fake but well-formed (64 hex), so paste parsing and the "shown once" flow
 * behave like the real one.
 */

export const MOCK_JOIN_TOKEN = 'a'.repeat(64);
export const MOCK_JOIN_OTHER_TOKEN = 'b'.repeat(64);

interface MockLink extends GroupInviteLink {
  token: string;
}

function mockLinkSeed(): MockLink[] {
  return [
    {
      id: 'link-friends',
      label: 'Friends',
      token: MOCK_JOIN_TOKEN,
      tokenHint: MOCK_JOIN_TOKEN.slice(-4),
      uses: 2,
      maxUses: 10,
      expiresAt: null,
      revoked: false,
      createdAt: '2026-09-01T10:00:00.000Z',
    },
    {
      id: 'link-standup',
      label: null,
      token: MOCK_JOIN_OTHER_TOKEN,
      tokenHint: MOCK_JOIN_OTHER_TOKEN.slice(-4),
      uses: 0,
      maxUses: null,
      expiresAt: null,
      revoked: false,
      createdAt: '2026-09-15T10:00:00.000Z',
    },
  ];
}

function viewOf(link: MockLink): GroupInviteLink {
  const { token: _token, ...view } = link;
  return view;
}

export interface MockInviteLinksStore {
  list(groupId: string): GroupInviteLink[];
  create(
    groupId: string,
    input: { label?: string; expiresInHours?: number; maxUses?: number },
  ): CreatedInviteLink;
  revoke(groupId: string, linkId: string): void;
  preview(token: string): JoinPreview;
  join(token: string): JoinResult;
}

/** One invite-links store per mock store, seeded with two Dev team links. */
export function createMockInviteLinksStore(): MockInviteLinksStore {
  let links = mockLinkSeed();
  let counter = 0;

  const byToken = (token: string): MockLink | undefined =>
    links.find((link) => link.token === token.toLowerCase());

  return {
    list(_groupId) {
      return links.map(viewOf);
    },
    create(_groupId, input) {
      counter += 1;
      const token = `${counter.toString(16).padStart(60, '0')}c0de`;
      const link: MockLink = {
        id: `link-mock-${counter}`,
        label: input.label ?? null,
        token,
        tokenHint: token.slice(-4),
        uses: 0,
        maxUses: input.maxUses ?? null,
        expiresAt:
          input.expiresInHours === undefined
            ? null
            : new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000).toISOString(),
        revoked: false,
        createdAt: new Date().toISOString(),
      };
      links = [link, ...links];
      return { id: link.id, token: link.token, url: `galena://join/${link.token}` };
    },
    revoke(_groupId, linkId) {
      links = links.map((link) => (link.id === linkId ? { ...link, revoked: true } : link));
    },
    preview(token) {
      const link = byToken(token);
      if (link === undefined || link.revoked) {
        const error = new Error('This link does not work') as Error & {
          status: number;
          code: string;
        };
        error.status = 404;
        error.code = 'invalid_link';
        throw error;
      }
      return { groupTitle: 'Dev team', memberCount: 6, alreadyMember: true, groupId: 'g-devteam' };
    },
    join(token) {
      const link = byToken(token);
      if (link === undefined || link.revoked) {
        const error = new Error('This link does not work') as Error & {
          status: number;
          code: string;
        };
        error.status = 404;
        error.code = 'invalid_link';
        throw error;
      }
      links = links.map((entry) =>
        entry.id === link.id ? { ...entry, uses: entry.uses + 1 } : entry,
      );
      return { groupId: 'g-devteam', alreadyMember: true };
    },
  };
}
