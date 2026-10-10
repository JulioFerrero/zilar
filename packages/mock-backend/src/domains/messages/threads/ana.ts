// Ana's DM thread (`ana@zilar.test`). Content is web's `c-ana` seed plus the
// reaction, correction and retraction stanzas that produce its chips, edit and
// two deleted placeholders.
import { file, image, voice } from '../builders';
import { ago, correction, JIDS, msg, reaction, retraction, type MockMessageSeed } from './shared';

const { you: YOU, ana: ANA } = JIDS;

export const anaMessages: readonly MockMessageSeed[] = [
  msg('ana-1', ANA, ago(3, 18, 30), { body: 'Hola! Are we still on for the concert?' }),
  msg('ana-2', YOU, ago(3, 18, 33), { body: 'Yes! I got the tickets 🎉' }),
  msg('ana-3', ANA, ago(3, 18, 34), {
    body: 'Amazing. Which **entrance**?',
    forward: {
      sender_id: 'luis@zilar.test',
      sender_name: 'Luis',
      chat_id: 'viernes@rooms.zilar.test',
      chat_name: 'Friday plans',
      original_at: '2026-08-30T18:00:00.000Z',
    },
  }),
  msg('ana-4', YOU, ago(3, 18, 40), { body: 'The one by the river.' }),
  msg('ana-5', ANA, ago(3, 18, 41), { body: 'Perfect, see you at 7.' }),
  msg('ana-6', ANA, ago(1, 20, 5), { body: 'Sent you the playlist' }),
  msg('ana-7', YOU, ago(1, 20, 12), { body: 'Listening now' }),
  msg('ana-8', ANA, ago(1, 20, 20), {
    payload: voice(18_000, 101, 'This one is my favourite, the bridge gives me chills.'),
  }),
  msg('ana-9', YOU, ago(1, 20, 25), { body: "Ok that's a great song" }),
  msg('ana-10', ANA, ago(1, 21, 0), { payload: image('#a0de7e', '#54cb68', 'Tickets') }),
  msg('ana-11', ANA, ago(1, 21, 1), { body: 'Found the tickets in my bag 😄' }),
  msg('ana-12', YOU, ago(1, 21, 40), { body: "Ha! At least we didn't lose them" }),
  msg('ana-13', ANA, ago(0, 8, 15), { body: 'Good morning ☀️' }),
  msg('ana-14', ANA, ago(0, 8, 16), { body: 'Do you want to grab coffee before?' }),
  msg('ana-15', YOU, ago(0, 8, 20), { body: 'Sure, at 6?' }),
  msg('ana-16', ANA, ago(0, 8, 21), { body: '6:30 is better' }),
  msg('ana-17', YOU, ago(0, 8, 22), { body: 'Deal' }),
  reaction('ana-17-r', ANA, ago(0, 8, 23), 'ana-17', ['👍']),
  msg('ana-18', ANA, ago(0, 9, 5), { body: "I'll book the place near the station" }),
  msg('ana-19', YOU, ago(0, 9, 6), { body: "You're the best" }),
  msg('ana-20', ANA, ago(0, 12, 30), { body: 'Bring snacks?' }),
  msg('ana-22', YOU, ago(0, 12, 31), { body: 'Coffee at 6:30 then' }),
  correction('ana-22-edit', YOU, ago(0, 12, 31), 'ana-22', 'Coffee at 6:30 then'),
  msg('ana-23', ANA, ago(0, 12, 32)),
  retraction('ana-23-retract', ANA, ago(0, 12, 32), 'ana-23'),
  msg('ana-24', YOU, ago(0, 12, 33)),
  retraction('ana-24-retract', YOU, ago(0, 12, 33), 'ana-24'),
  msg('ana-25', ANA, ago(0, 12, 34), { body: 'Perfect', replyTo: { id: 'ana-23' } }),
  msg('ana-26', ANA, ago(0, 12, 35), { body: 'Bringing the snacks', replyTo: { id: 'ana-22' } }),
  msg('ana-27', ANA, ago(0, 12, 36), {
    body: 'The stage looks amazing',
    payload: image('#7dd3fc', '#6366f1', 'Stage'),
  }),
  msg('ana-28', ANA, ago(0, 12, 37), {
    payload: file(
      'https://files.zilar.test/ana/tickets.pdf',
      'tickets.pdf',
      2_411_724,
      'application/pdf',
    ),
  }),
  msg('ana-21', ANA, ago(0, 12, 41), { body: 'See you tonight ❤️' }),
  reaction('ana-21-r-ana', ANA, ago(0, 12, 42), 'ana-21', ['❤️', '👍']),
  reaction('ana-21-r-you', YOU, ago(0, 12, 43), 'ana-21', ['❤️']),
];
