// The QA squad room (`qa@rooms.zilar.test`), web's `c-qa`.
import { progressCard } from '../builders';
import { ago, JIDS, msg, type MockMessageSeed } from './shared';

const { luis: LUIS, qa1: QA1 } = JIDS;

export const qaMessages: readonly MockMessageSeed[] = [
  msg('qa-1', QA1, ago(2, 9, 0), { body: 'Running the regression suite.' }),
  msg('qa-2', QA1, ago(2, 9, 1), {
    payload: progressCard({ stage: 'Running regression suite', percent: 55 }),
  }),
  msg('qa-3', QA1, ago(2, 9, 30), { body: '3 failures, all in checkout.' }),
  msg('qa-4', LUIS, ago(2, 9, 35), { body: 'On it.' }),
  msg('qa-5', QA1, ago(2, 10, 0), { body: 'Fixed in the latest build.' }),
];
