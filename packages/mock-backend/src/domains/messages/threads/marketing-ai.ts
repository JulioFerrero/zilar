// The Marketing AI DM (`marketing@ai.zilar.test`), web's `c-marketingai`.
import { ago, JIDS, msg, type MockMessageSeed } from './shared';

const { you: YOU, marketing: MARKETING } = JIDS;

export const marketingAiMessages: readonly MockMessageSeed[] = [
  msg('mai-1', YOU, ago(5, 10, 0), { body: 'Draft a launch post for the beta.' }),
  msg('mai-2', MARKETING, ago(5, 10, 20), { body: 'Here are three options.' }),
  msg('mai-3', MARKETING, ago(5, 10, 21), { body: 'Option A is the punchiest, in my opinion.' }),
  msg('mai-4', YOU, ago(5, 10, 25), { body: 'Option A it is.' }),
];
