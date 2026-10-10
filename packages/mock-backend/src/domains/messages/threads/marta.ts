// Marta's DM thread (`marta@zilar.test`), web's `c-marta`.
import { ago, JIDS, msg, type MockMessageSeed } from './shared';

const { you: YOU, marta: MARTA } = JIDS;

export const martaMessages: readonly MockMessageSeed[] = [
  msg('mar-1', MARTA, ago(1, 9, 0), { body: 'Did you get the file I sent?' }),
  msg('mar-2', YOU, ago(1, 9, 5), { body: 'Yes, thanks!' }),
  msg('mar-3', MARTA, ago(1, 9, 12), { body: 'Great, let me know if it opens.' }),
];
