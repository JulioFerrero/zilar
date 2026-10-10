// The Gym buddies room (`gym@rooms.zilar.test`), web's `c-gym`.
import { ago, JIDS, msg, type MockMessageSeed } from './shared';

const { you: YOU, marco: MARCO } = JIDS;

export const gymMessages: readonly MockMessageSeed[] = [
  msg('gym-1', MARCO, ago(30, 7, 0), { body: 'Leg day tomorrow?' }),
  msg('gym-2', YOU, ago(30, 7, 5), { body: 'Never skip leg day' }),
  msg('gym-3', MARCO, ago(30, 7, 6), { body: "That's the spirit 💪" }),
];
