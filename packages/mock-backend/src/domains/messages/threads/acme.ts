// The Acme Announcements channel (`acme@rooms.zilar.test`), web's `c-acme`:
// the mock user is its owner, so the one post is theirs.
import { ago, JIDS, msg, type MockMessageSeed } from './shared';

const { you: YOU } = JIDS;

export const acmeMessages: readonly MockMessageSeed[] = [
  msg('acme-1', YOU, ago(2, 9, 30), { body: 'Acme 2.4 is out: faster sync, quieter badges.' }),
];
