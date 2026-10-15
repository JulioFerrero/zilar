// The Checkout topic (`t-devteam-bug@rooms.zilar.test`), web's Bug topic: the
// Dev AI hands the checkout fix to QA-1, who asks which iPhone to test on with
// the reply-chip question card (T-1578).
import { questionCard } from '../builders';
import { ago, JIDS, msg, type MockMessageSeed } from './shared';

const { dev1: DEV1, qa1: QA1 } = JIDS;

const QUESTION = 'Which iPhone should I test on?';
const OPTIONS = ['iPhone 15', 'iPhone 12', 'Both'];

// The card's fallback body, the same `question` plus `n. option` lines the real
// server sends (T-1576), for a client that cannot render the payload.
const FALLBACK = [QUESTION, ...OPTIONS.map((option, index) => `${index + 1}. ${option}`)].join(
  '\n',
);

export const checkoutMessages: readonly MockMessageSeed[] = [
  msg('bug-1', DEV1, ago(0, 11, 30), { body: 'PR #42 is on staging.' }),
  msg('bug-2', DEV1, ago(0, 11, 32), {
    body: '@QA-1 can you check it on an iPhone?',
    mentions: [{ jid: JIDS.qa1, begin: 0, end: 5 }],
  }),
  msg('bug-3', QA1, ago(0, 11, 35), {
    body: FALLBACK,
    payload: questionCard('q-bug-1', QUESTION, OPTIONS),
  }),
];
