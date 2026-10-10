// The seed's people: the viewer, the human contacts and the viewer's AIs.
// Every person has a bare JID (the API's own keying); `id` is the stable client
// id the old per-app seeds used, kept so row keys and deep links do not churn.

export interface MockPerson {
  readonly id: string;
  readonly name: string;
  readonly jid: string;
  readonly kind: 'human' | 'ai';
}

/** The signed-in viewer. */
export const currentUser: MockPerson = {
  id: 'u-you',
  name: 'You',
  jid: 'you@zilar.test',
  kind: 'human',
};

export const people: readonly MockPerson[] = [
  { id: 'u-ana', name: 'Ana', jid: 'ana@zilar.test', kind: 'human' },
  { id: 'u-luis', name: 'Luis', jid: 'luis@zilar.test', kind: 'human' },
  { id: 'u-marta', name: 'Marta', jid: 'marta@zilar.test', kind: 'human' },
  { id: 'u-marco', name: 'Marco', jid: 'marco@zilar.test', kind: 'human' },
  { id: 'u-sofia', name: 'Sofía', jid: 'sofia@zilar.test', kind: 'human' },
  { id: 'ai-dev-1', name: 'Dev-1', jid: 'dev-1@ai.zilar.test', kind: 'ai' },
  { id: 'ai-qa-1', name: 'QA-1', jid: 'qa-1@ai.zilar.test', kind: 'ai' },
  { id: 'ai-marketing', name: 'Marketing AI', jid: 'marketing@ai.zilar.test', kind: 'ai' },
];

/** The `/api/me` body the seed owns; `GET`/`PATCH /me` serve this shape. */
export interface MockMe {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly image: string | null;
  readonly handle: string | null;
  readonly jid: string;
}

export function defaultMe(): MockMe {
  return {
    id: currentUser.id,
    email: 'you@zilar.test',
    name: currentUser.name,
    image: null,
    handle: null,
    jid: currentUser.jid,
  };
}
