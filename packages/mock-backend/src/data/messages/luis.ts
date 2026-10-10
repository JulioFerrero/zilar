// Luis's DM thread (`luis@zilar.test`), web's `c-luis`.
import { ago, JIDS, msg, type MockMessageSeed } from './shared';

const { you: YOU, luis: LUIS } = JIDS;

export const luisMessages: readonly MockMessageSeed[] = [
  msg('lui-1', LUIS, ago(4, 21, 0), { body: 'Did you watch the match?' }),
  msg('lui-2', YOU, ago(4, 21, 10), { body: 'Only the highlights.' }),
  msg('lui-3', LUIS, ago(4, 21, 12), { body: 'Unreal finish ⚽' }),
];
