// The Product room (`product@rooms.zilar.test`), web's `c-product`.
import { ago, JIDS, msg, type MockMessageSeed } from './shared';

const { you: YOU, ana: ANA } = JIDS;

export const productMessages: readonly MockMessageSeed[] = [
  msg('pro-1', ANA, ago(35, 16, 0), { body: 'Roadmap review moved to Thursday.' }),
  msg('pro-2', YOU, ago(35, 16, 5), { body: 'Works for me.' }),
];
