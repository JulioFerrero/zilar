import type {
  CreatedInviteLink,
  GroupInviteLink,
  JoinPreview,
  JoinResult,
} from '../lib/invite-links-api';

/**
 * The mock invite-links backend (T-0136): one in-memory link store per mock
 * store, covering create, list, revoke, preview and join. Links are keyed
 * per group id, and preview/join enforce the server rules (revoked,
 * expired and used-up links fail with the same neutral error, like
 * `previewInviteLink`/`joinByInviteLink` in
 * `apps/server/src/invite-links/service.ts`). The tokens are fake but
 * well-formed (64 hex), so paste parsing and the "shown once" flow behave
 * like the real one.
 */

export const MOCK_JOIN_TOKEN = 'a'.repeat(64);
export const MOCK_JOIN_OTHER_TOKEN = 'b'.repeat(64);

interface MockLink extends GroupInviteLink {
  token: string;
  groupId: string;
}

interface MockGroup {
  title: string;
  memberCount: number;
}

const MOCK_GROUPS: Record<string, MockGroup> = {
  'g-devteam': { title: 'Dev team', memberCount: 6 },
  'g-neighbors': { title: 'Neighbors', memberCount: 8 },
};

function mockLinkSeed(): MockLink[] {
  return [
    {
      id: 'link-friends',
      groupId: 'g-devteam',
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
      groupId: 'g-devteam',
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
  const { token: _token, groupId: _groupId, ...view } = link;
  return view;
}

function isUsable(link: MockLink, now: number): boolean {
  if (link.revoked) {
    return false;
  }
  if (link.expiresAt !== null && Date.parse(link.expiresAt) <= now) {
    return false;
  }
  if (link.maxUses !== null && link.uses >= link.maxUses) {
    return false;
  }
  return true;
}

function invalidLinkError(): Error & { status: number; code: string } {
  const error = new Error('This link does not work') as Error & {
    status: number;
    code: string;
  };
  error.status = 404;
  error.code = 'invalid_link';
  return error;
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

/**
 * Who the mock viewer already is: preview answers `alreadyMember` from this
 * (like the server's membership check) instead of hardcoding `true`, so a
 * link for a group the viewer is not in exercises the real Join path in mock
 * mode. The chat store answers from its group detail; standalone users pass
 * their own.
 */
export interface MockInviteLinksMembership {
  isMember: (groupId: string) => boolean;
}

/** One invite-links store per mock store, seeded with two Dev team links. */
export function createMockInviteLinksStore(
  membership: MockInviteLinksMembership = { isMember: () => true },
): MockInviteLinksStore {
  let links = mockLinkSeed();
  let counter = 0;
  // Groups the viewer joined through this store. The server records the
  // membership on join while the seeded detail snapshots never change, so
  // the store tracks its own joins (a second preview then reads
  // `alreadyMember`, and a second join consumes no use, like the server).
  const joined = new Set<string>();

  const isMember = (groupId: string): boolean =>
    joined.has(groupId) || membership.isMember(groupId);

  const byToken = (token: string): MockLink | undefined =>
    links.find((link) => link.token === token.toLowerCase());

  return {
    list(groupId) {
      return links.filter((link) => link.groupId === groupId).map(viewOf);
    },
    create(groupId, input) {
      counter += 1;
      const token = `${counter.toString(16).padStart(60, '0')}c0de`;
      const link: MockLink = {
        id: `link-mock-${counter}`,
        groupId,
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
      return { id: link.id, token: link.token, url: `zilar://join/${link.token}` };
    },
    revoke(groupId, linkId) {
      links = links.map((link) =>
        link.id === linkId && link.groupId === groupId ? { ...link, revoked: true } : link,
      );
    },
    preview(token) {
      const now = Date.now();
      const link = byToken(token);
      if (link === undefined || !isUsable(link, now)) {
        throw invalidLinkError();
      }
      const group = MOCK_GROUPS[link.groupId] ?? { title: 'Group', memberCount: 0 };
      const alreadyMember = isMember(link.groupId);
      return {
        groupTitle: group.title,
        memberCount: group.memberCount,
        alreadyMember,
        // Like the server: the preview only names the group id to a member
        // (they know it; the join screen uses it to open the group).
        ...(alreadyMember ? { groupId: link.groupId } : {}),
      };
    },
    join(token) {
      const now = Date.now();
      const link = byToken(token);
      if (link === undefined || !isUsable(link, now)) {
        throw invalidLinkError();
      }
      // Already a member: no use consumed, like the server.
      if (isMember(link.groupId)) {
        return { groupId: link.groupId, alreadyMember: true };
      }
      joined.add(link.groupId);
      links = links.map((entry) =>
        entry.id === link.id ? { ...entry, uses: entry.uses + 1 } : entry,
      );
      return { groupId: link.groupId, alreadyMember: false };
    },
  };
}
