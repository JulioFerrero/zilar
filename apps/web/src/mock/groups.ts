import type { GroupAi, GroupDetail, GroupMember, PublicAi } from '@/lib/api';

const DOMAIN = 'zilar.test';
const OWNER = 'u-you';

function member(
  userId: string,
  name: string,
  role: GroupMember['role'],
  roles: GroupMember['roles'] = [],
): GroupMember {
  return { userId, name, role, roles };
}

// AIs are provisioned as `ai-<aiId>`; the id is the localpart without the
// `ai-` prefix, so `dev-1` becomes `ai-dev-1@zilar.test`.
function ai(aiId: string, name: string, ownerId: string): GroupAi {
  return { aiId, jid: `ai-${aiId}@${DOMAIN}`, name, ownerId };
}

function ownedAi(id: string, name: string, template: PublicAi['template']): PublicAi {
  return {
    id,
    name,
    template,
    persona: `${name} is a helpful assistant.`,
    model: 'gpt-4o',
    jid: `ai-${id}@${DOMAIN}`,
    status: 'active',
    providerConnectionId: 'conn-mock',
    limits: { perDayUsd: 2, perMonthUsd: 20 },
    createdAt: '2026-09-20T10:00:00.000Z',
  };
}

/** The group detail (people + AIs) of every mock group, keyed by chat id. */
export const mockGroupDetails: Record<string, GroupDetail> = {
  'c-devteam': {
    id: 'g-devteam',
    title: 'Dev team',
    createdBy: OWNER,
    members: [
      member('u-you', 'You', 'owner', [
        { id: 'role-designers', name: 'Designers' },
        { id: 'role-devs', name: 'Devs' },
      ]),
      member('u-ana', 'Ana', 'admin', [{ id: 'role-designers', name: 'Designers' }]),
      member('u-luis', 'Luis', 'member', [{ id: 'role-devs', name: 'Devs' }]),
      member('u-marco', 'Marco', 'member'),
    ],
    ais: [ai('dev-1', 'Dev-1', OWNER), ai('qa-1', 'QA-1', OWNER)],
  },
  'c-viernes': {
    id: 'g-viernes',
    title: 'Viernes 🍻',
    createdBy: 'u-luis',
    members: [
      member('u-luis', 'Luis', 'owner'),
      member('u-you', 'You', 'member'),
      member('u-marta', 'Marta', 'member'),
      member('u-ana', 'Ana', 'member'),
      member('u-marco', 'Marco', 'member'),
    ],
    ais: [],
  },
  'c-familia': {
    id: 'g-familia',
    title: 'Familia',
    createdBy: OWNER,
    members: [member('u-you', 'You', 'owner'), member('u-sofia', 'Sofía', 'member')],
    ais: [],
  },
  'c-qa': {
    id: 'g-qa',
    title: 'QA squad',
    createdBy: 'u-luis',
    members: [member('u-luis', 'Luis', 'owner'), member('u-you', 'You', 'admin')],
    ais: [ai('qa-1', 'QA-1', OWNER)],
  },
  'c-gym': {
    id: 'g-gym',
    title: 'Gym buddies',
    createdBy: 'u-marco',
    members: [member('u-marco', 'Marco', 'owner'), member('u-you', 'You', 'member')],
    ais: [],
  },
  'c-product': {
    id: 'g-product',
    title: 'Product',
    createdBy: OWNER,
    members: [member('u-you', 'You', 'owner'), member('u-ana', 'Ana', 'member')],
    ais: [],
  },
  // T-0124: the mock channel's detail (the feed id is the chat id). The mock
  // user is its owner; Ana is an admin, Luis a subscriber.
  // T-0164: public with the `@acme` handle, so Explore and the `/@acme`
  // share card have content in mock mode.
  'c-acme': {
    id: 'g-acme',
    title: 'Acme Announcements',
    createdBy: OWNER,
    kind: 'channel',
    description: 'Release notes and team news.',
    visibility: 'public',
    handle: 'acme',
    members: [
      member('u-you', 'You', 'owner'),
      member('u-ana', 'Ana', 'admin'),
      member('u-luis', 'Luis', 'member'),
    ],
    ais: [],
  },
};

/** The AIs the mock user owns, for the group panel's add picker. */
export const mockOwnedAis: PublicAi[] = [
  ownedAi('dev-1', 'Dev-1', 'dev'),
  ownedAi('qa-1', 'QA-1', 'dev'),
  ownedAi('marketing', 'Marketing AI', 'marketing'),
  ownedAi('research-1', 'Researcher', 'custom'),
];
