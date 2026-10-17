// The Ideas topic (`t-devteam-ideas@rooms.zilar.test`), T-1808: a short public
// thread the viewer is not a member of, so the Join view has a preview to show.
import type { Payload } from '@zilar/protocol';
import { ago, JIDS, msg, type MockMessageSeed } from './shared';

const { ana: ANA, luis: LUIS, dev1: DEV1 } = JIDS;

const shortlistCard: Payload = {
  v: 0,
  type: 'blocks',
  data: {
    title: 'Friday demo shortlist',
    fallback: 'Friday demo shortlist: one idea picked, two waiting for a volunteer.',
    blocks: [
      {
        kind: 'checklist',
        id: 'ideas-shortlist',
        title: 'Shortlist',
        items: [
          { id: 'ideas-item-1', label: 'Saved replies for new members', done: true, by: 'Ana' },
          { id: 'ideas-item-2', label: 'A weekly office-hours slot', done: false },
          { id: 'ideas-item-3', label: 'Topic digests in the inbox', done: false },
        ],
      },
    ],
  },
};

export const ideasMessages: readonly MockMessageSeed[] = [
  msg('ideas-1', ANA, ago(6, 10, 4), {
    body: 'Idea: a ten-minute demo slot on Fridays, no slides allowed.',
  }),
  msg('ideas-2', LUIS, ago(6, 10, 9), {
    body: 'I like it. Who wants to go first?',
  }),
  msg('ideas-3', DEV1, ago(6, 10, 12), {
    body: 'I collected the first three candidates in a card.',
    payload: shortlistCard,
  }),
  msg('ideas-4', ANA, ago(6, 10, 18), {
    body: 'Great. Let us pick one at standup tomorrow.',
  }),
];
