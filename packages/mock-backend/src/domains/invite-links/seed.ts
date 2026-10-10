// The invite-link seed (T-0115): two links for the Dev team and Neighbors
// groups, mirroring the mobile mock. A link's raw token is shown once and kept
// out of the row; the state maps it to the link id, so the list only ever
// carries `tokenHint`, like the real server.
export interface MockInviteLink {
  id: string;
  groupId: string;
  label: string | null;
  tokenHint: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}

export const MOCK_JOIN_TOKEN = 'a'.repeat(64);
export const MOCK_NEIGHBORS_TOKEN = 'b'.repeat(64);

export function seedInviteLinks(): readonly MockInviteLink[] {
  return [
    {
      id: 'link-friends',
      groupId: 'g-devteam',
      label: 'Friends',
      tokenHint: MOCK_JOIN_TOKEN.slice(-4),
      uses: 2,
      maxUses: 10,
      expiresAt: null,
      revoked: false,
      createdAt: '2026-09-01T10:00:00.000Z',
    },
    {
      id: 'link-neighbors',
      groupId: 'g-neighbors',
      label: null,
      tokenHint: MOCK_NEIGHBORS_TOKEN.slice(-4),
      uses: 0,
      maxUses: null,
      expiresAt: null,
      revoked: false,
      createdAt: '2026-09-15T10:00:00.000Z',
    },
  ];
}

/** The shown-once tokens of the seed links, keyed by token to link id. */
export function seedInviteTokens(): Record<string, string> {
  return {
    [MOCK_JOIN_TOKEN]: 'link-friends',
    [MOCK_NEIGHBORS_TOKEN]: 'link-neighbors',
  };
}
