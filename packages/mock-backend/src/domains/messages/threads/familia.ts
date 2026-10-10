// The Familia room (`familia@rooms.zilar.test`), web's `c-familia`.
import { ago, JIDS, msg, type MockMessageSeed } from './shared';

const { you: YOU, sofia: SOFIA } = JIDS;

export const familiaMessages: readonly MockMessageSeed[] = [
  msg('fam-1', SOFIA, ago(1, 7, 30), { body: 'Dinner on Sunday?' }),
  msg('fam-2', SOFIA, ago(1, 7, 31), { body: 'Mum is making paella 🥘' }),
  msg('fam-3', YOU, ago(1, 7, 40), { body: "I'll be there" }),
  msg('fam-4', SOFIA, ago(1, 8, 0), { body: 'Bring the kids!' }),
  msg('fam-5', SOFIA, ago(1, 8, 5), { body: 'And a dessert 🍰' }),
  msg('fam-6', SOFIA, ago(1, 8, 6), { body: "Also, who's driving?" }),
  msg('fam-7', SOFIA, ago(1, 8, 7), { body: 'Hello? 😅' }),
];
