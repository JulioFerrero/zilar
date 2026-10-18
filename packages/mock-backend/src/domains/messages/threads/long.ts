// A generated 800-message backlog for the Viernes room (`viernes@rooms.zilar.test`),
// prepended to its thread in `index.ts`. The mock build has no live data, so this
// is the long thread the chat scroll audit measures: one group with avatars,
// replies, reactions, links, images and a few edits, paged 50 at a time.
//
// The loop is deterministic: the same ids, bodies and offsets every run, and the
// timestamps step a few minutes back with a nightly gap, so day separators show.
import { image } from '../builders';
import { correction, JIDS, msg, reaction, type MockMessageSeed } from './shared';

const { you: YOU, ana: ANA, luis: LUIS, marta: MARTA, marco: MARCO } = JIDS;

const COUNT = 800;
const STEP_MINUTES = 5;
const BASE_MINUTES_AGO = 3 * 1440;
const GAP_EVERY = 50;
const GAP_MINUTES = 600;
const SENDERS = [ANA, LUIS, MARTA, MARCO, YOU] as const;
const REACTIONS = ['👍', '😂', '❤️', '🔥', '🎉'] as const;
const CHATTER = [
  'Table for six?',
  'I can be there by nine',
  'Who is bringing the speaker?',
  'Same place as last time',
  'I booked the corner table',
  'Ana, did you get the message?',
  'The rooftop closes at midnight',
  'Bring a jacket, it gets cold',
] as const;
const LINKS = [
  'https://zilar.test/plans/friday-night',
  'https://example.com/bars/rooftop',
  'https://example.com/recipes/paella',
  'https://zilar.test/playlists/friday',
] as const;
const IMAGE_TINTS = [
  ['#ffcd6a', '#ffa85c', 'Rooftop'],
  ['#8bd3dd', '#5c9ead', 'Tapas'],
  ['#f2a8b4', '#d96c8a', 'Sunset'],
  ['#b8e0a8', '#6fae5c', 'Terrace'],
] as const;
const LONG_TEXT = [
  'Friday logistics, long version:',
  '- I called three places and only one takes six without a deposit.',
  '- The rooftop has a two-hour limit after 21:00.',
  '- Someone bring a speaker and a deck of cards.',
  'Reply here if you want the corner table.',
].join('\n');

/** Minutes before the seed clock: older for a lower index, with night gaps. */
function minutesAgo(index: number): number {
  const position = COUNT - index;
  return (
    BASE_MINUTES_AGO + position * STEP_MINUTES + Math.floor(position / GAP_EVERY) * GAP_MINUTES
  );
}

function bodyFor(index: number): string {
  if (index % 40 === 0) {
    return `${LONG_TEXT}\nRecap ${index}.`;
  }
  if (index % 11 === 0) {
    return `${LINKS[(index / 11) % LINKS.length] ?? LINKS[0]} worth a look`;
  }
  return CHATTER[index % CHATTER.length] ?? CHATTER[0];
}

function imageFor(index: number): NonNullable<MockMessageSeed['payload']> {
  const tint = IMAGE_TINTS[index % IMAGE_TINTS.length] ?? IMAGE_TINTS[0];
  return image(tint[0], tint[1], `${tint[2]} ${index}`);
}

function buildLongMessages(): readonly MockMessageSeed[] {
  const seeds: MockMessageSeed[] = [];
  for (let index = 0; index < COUNT; index += 1) {
    const id = `long-${index}`;
    const sender = SENDERS[index % SENDERS.length] ?? YOU;
    const at = minutesAgo(index);
    const body = bodyFor(index);
    seeds.push(
      msg(id, sender, at, {
        body,
        ...(index % 25 === 0 ? { payload: imageFor(index) } : {}),
        ...(index % 7 === 0 && index > 0 ? { replyTo: { id: `long-${index - 7}` } } : {}),
      }),
    );
    if (index % 5 === 0) {
      const first = SENDERS[(index + 1) % SENDERS.length] ?? ANA;
      seeds.push(
        reaction(`long-${index}-r1`, first, at - 1, id, [
          REACTIONS[index % REACTIONS.length] ?? '👍',
        ]),
      );
      if (index % 10 === 0) {
        const second = SENDERS[(index + 2) % SENDERS.length] ?? LUIS;
        seeds.push(
          reaction(`long-${index}-r2`, second, at - 2, id, [
            REACTIONS[(index + 2) % REACTIONS.length] ?? '🔥',
          ]),
        );
      }
    }
    if (index % 60 === 0) {
      seeds.push(correction(`long-${index}-edit`, sender, at - 3, id, `${body} (edited)`));
    }
  }
  return seeds;
}

export const longMessages: readonly MockMessageSeed[] = buildLongMessages();
