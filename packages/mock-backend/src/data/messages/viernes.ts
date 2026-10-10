// The Viernes 🍻 room thread (`viernes@rooms.zilar.test`), web's `c-viernes`.
import { image, voice } from '../builders';
import { ago, correction, JIDS, msg, reaction, retraction, type MockMessageSeed } from './shared';

const { you: YOU, ana: ANA, luis: LUIS, marta: MARTA, marco: MARCO } = JIDS;

export const viernesMessages: readonly MockMessageSeed[] = [
  msg('vie-1', LUIS, ago(2, 17, 0), { body: 'Friday plans?' }),
  msg('vie-2', MARTA, ago(2, 17, 2), { body: 'Bar again?' }),
  msg('vie-3', LUIS, ago(2, 17, 3), { body: 'Obvio 🍻' }),
  msg('vie-4', MARCO, ago(2, 17, 5), { body: "I'm in" }),
  msg('vie-5', ANA, ago(2, 17, 6), { body: 'Count me in!' }),
  msg('vie-6', YOU, ago(2, 17, 10), { body: 'Same' }),
  msg('vie-7', MARTA, ago(2, 17, 12), { payload: image('#ffcd6a', '#ffa85c', 'Viernes') }),
  msg('vie-8', MARTA, ago(2, 17, 13), { body: 'Last time was fun 😂' }),
  msg('vie-9', LUIS, ago(2, 17, 15), { body: 'Who took that?', replyTo: { id: 'vie-7' } }),
  msg('vie-10', MARTA, ago(2, 17, 16), {
    body: 'The waiter, obviously',
    replyTo: { id: 'vie-9' },
  }),
  msg('vie-11', ANA, ago(2, 17, 17), { body: '😂😂' }),
  reaction('vie-11-r-luis', LUIS, ago(2, 17, 18), 'vie-11', ['😂']),
  reaction('vie-11-r-marta', MARTA, ago(2, 17, 19), 'vie-11', ['😂']),
  msg('vie-12', MARCO, ago(1, 12, 0), { body: 'What time?' }),
  msg('vie-13', LUIS, ago(1, 12, 1), { body: '20:30' }),
  msg('vie-14', MARTA, ago(1, 12, 30), { body: 'Bringing a friend' }),
  msg('vie-15', LUIS, ago(1, 12, 31), { body: 'More the merrier' }),
  msg('vie-16', YOU, ago(1, 13, 0), { body: "I'll reserve a table" }),
  msg('vie-17', ANA, ago(1, 13, 2), { body: 'MVP 🏆' }),
  reaction('vie-17-r-luis', LUIS, ago(1, 13, 3), 'vie-17', ['🏆']),
  reaction('vie-17-r-marta', MARTA, ago(1, 13, 4), 'vie-17', ['🏆']),
  reaction('vie-17-r-marco', MARCO, ago(1, 13, 5), 'vie-17', ['🏆']),
  reaction('vie-17-r-you', YOU, ago(1, 13, 6), 'vie-17', ['👍']),
  msg('vie-18', LUIS, ago(0, 19, 0), {
    payload: voice(9_000, 202, "Oi, I'm running ten minutes late, start without me!"),
  }),
  msg('vie-19', MARTA, ago(0, 19, 2), { body: 'Classic Luis' }),
  msg('vie-20', MARCO, ago(0, 19, 3), { body: 'Already ordering' }),
  msg('vie-21', ANA, ago(0, 19, 4), { body: 'Save me a seat 💺' }),
  msg('vie-23', MARTA, ago(0, 19, 5), { body: 'Bringing a friend, she is in town' }),
  correction('vie-23-edit', MARTA, ago(0, 19, 5), 'vie-23', 'Bringing a friend, she is in town'),
  msg('vie-24', LUIS, ago(0, 19, 6)),
  retraction('vie-24-retract', LUIS, ago(0, 19, 6), 'vie-24'),
  msg('vie-25', YOU, ago(0, 19, 7)),
  retraction('vie-25-retract', YOU, ago(0, 19, 7), 'vie-25'),
  msg('vie-26', MARCO, ago(0, 19, 8), {
    body: 'Table for six then',
    replyTo: { id: 'vie-23' },
  }),
  msg('vie-27', ANA, ago(0, 19, 9), { body: 'Noted 🍻' }),
  msg('vie-22', YOU, ago(0, 19, 10), { body: 'On my way' }),
  reaction('vie-22-r-you', YOU, ago(0, 19, 11), 'vie-22', ['🚀']),
  reaction('vie-22-r-ana', ANA, ago(0, 19, 12), 'vie-22', ['🚀']),
];
