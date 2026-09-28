import { PayloadSchema, type Payload } from '@galena/protocol';

import { gradientImage } from '../lib/image-presets';
import { CURRENT_USER_ID, CURRENT_USER_NAME, type UiMessage } from '../lib/types';
import { at, hoursFromNow } from './time';

type Sender = { id: string; name: string };

const ME: Sender = { id: CURRENT_USER_ID, name: CURRENT_USER_NAME };
const ANA: Sender = { id: 'ana', name: 'Ana' };
const LUIS: Sender = { id: 'luis', name: 'Luis' };
const SARA: Sender = { id: 'sara', name: 'Sara' };
const MARTA: Sender = { id: 'marta', name: 'Marta' };
const DIEGO: Sender = { id: 'diego', name: 'Diego' };
const RUBEN: Sender = { id: 'ruben', name: 'Rubén' };
const SOFIA: Sender = { id: 'sofia', name: 'Sofía' };
const DANI: Sender = { id: 'dani', name: 'Dani' };
const MAMA: Sender = { id: 'mama', name: 'Mamá' };
const PAPA: Sender = { id: 'papa', name: 'Papá' };
const DEV_AI: Sender = { id: 'dev-ai', name: 'Dev AI' };
const MARKETING_AI: Sender = { id: 'marketing-ai', name: 'Marketing AI' };

type Content = Partial<Pick<UiMessage, 'text' | 'voice' | 'image' | 'card' | 'replyTo' | 'status'>>;

function message(
  chatId: string,
  id: string,
  sender: Sender,
  createdAt: Date,
  content: Content,
): UiMessage {
  return {
    id,
    chatId,
    senderId: sender.id,
    senderName: sender.name,
    createdAt,
    status: 'read',
    ...content,
  };
}

/** Payloads are parsed, so mock data stays valid against `@galena/protocol`. */
function payload(input: Payload): Payload {
  return PayloadSchema.parse(input);
}

function progressCard(stage: string, percent: number, detail?: string): Payload {
  return payload({
    v: 0,
    type: 'progress',
    data: {
      ai: 'dev-ai@galena.chat',
      stage,
      ...(detail === undefined ? {} : { detail }),
      percent,
    },
  });
}

const WAVEFORM = [
  26, 44, 62, 38, 20, 34, 58, 72, 52, 30, 18, 40, 66, 80, 56, 32, 24, 48, 70, 60, 36, 22, 42, 64,
  50, 28, 38, 54,
];

const VOICE = {
  duration_ms: 12_400,
  mime: 'audio/ogg; codecs=opus',
  waveform: WAVEFORM,
  transcript: {
    text: "Plan is: terrace at nine, bring something to share. I'll get the ice.",
    language: 'en',
    source: 'local' as const,
  },
};

const APPROVAL: Payload = payload({
  v: 0,
  type: 'approval.request',
  data: {
    id: 'approval-2001',
    room: 'dev-ai@galena.chat',
    ai: 'dev-ai@galena.chat',
    action: 'Rotate the staging API token',
    summary: 'The staging token leaked in a CI log. Rotate it and update the CI secret.',
    args_hash: '8f14e45fceea167a5a36dedd4bea2543c9f4d5a7b0c1e2d3f4a5b6c7d8e9f0a1',
    worst_case_cost: { currency: 'EUR', amount: 0.02 },
    requested_by: 'me@galena.chat',
    expires_at: hoursFromNow(2),
  },
});

export const mockMessagesByChat: Record<string, UiMessage[]> = {
  ana: [
    message('ana', 'ana-01', ANA, at(2, 18, 2), { text: 'Hey! Are you around this weekend?' }),
    message('ana', 'ana-02', ME, at(2, 18, 5), {
      text: 'Saturday works. What do you have in mind?',
    }),
    message('ana', 'ana-03', ANA, at(2, 18, 6), { text: 'Nothing planned yet. Maybe dinner?' }),
    message('ana', 'ana-04', ME, at(2, 18, 7), { text: "I'm in 😄" }),
    message('ana', 'ana-05', ME, at(1, 21, 12), { text: 'Found a nice place near the river.' }),
    message('ana', 'ana-06', ANA, at(1, 21, 14), { text: 'Ooh, which one?' }),
    message('ana', 'ana-07', ME, at(1, 21, 15), { text: "It's called Marea, by the bridge." }),
    message('ana', 'ana-08', ANA, at(1, 21, 16), { text: 'I know it! Great choice' }),
    message('ana', 'ana-09', ME, at(1, 21, 20), { text: 'Dinner on Friday? I can book.' }),
    message('ana', 'ana-10', ANA, at(1, 21, 21), { text: "Yes! Let's do it" }),
    message('ana', 'ana-11', ME, at(1, 21, 22), { text: 'Booked for 21:00 ✅' }),
    message('ana', 'ana-12', ANA, at(0, 12, 30), {
      text: 'I found that other place with the terrace 🌿',
    }),
    message('ana', 'ana-13', ME, at(0, 12, 31), { text: 'Even better. Same time?' }),
    message('ana', 'ana-14', ME, at(0, 12, 35), { text: 'Also bringing the camera 📷' }),
    message('ana', 'ana-15', ANA, at(0, 12, 36), { text: 'Perfect 😊' }),
    message('ana', 'ana-16', ANA, at(0, 12, 41), { text: 'See you tonight ❤️' }),
  ],
  viernes: [
    message('viernes', 'viernes-01', LUIS, at(1, 20, 10), { text: 'Friday is looking good 🍻' }),
    message('viernes', 'viernes-02', MARTA, at(1, 20, 12), { text: 'Finally!' }),
    message('viernes', 'viernes-03', ANA, at(1, 20, 13), { text: "Who's bringing the speaker?" }),
    message('viernes', 'viernes-04', ME, at(1, 20, 14), { text: 'I can bring mine' }),
    message('viernes', 'viernes-05', LUIS, at(1, 20, 15), { text: 'Legend' }),
    message('viernes', 'viernes-06', ANA, at(0, 10, 2), { voice: VOICE }),
    message('viernes', 'viernes-07', LUIS, at(0, 10, 5), {
      text: '🎧 on it',
      replyTo: { id: 'viernes-06', senderName: 'Ana', text: '🎤 Voice message (0:12)' },
    }),
    message('viernes', 'viernes-08', MARTA, at(0, 10, 20), {
      image: { url: gradientImage('sunset'), width: 1200, height: 800 },
    }),
    message('viernes', 'viernes-09', ME, at(0, 12, 31), { text: 'Great pic 😂' }),
    message('viernes', 'viernes-10', ANA, at(0, 12, 37), { text: 'ok!' }),
    message('viernes', 'viernes-11', ME, at(0, 12, 38), { text: 'See you there' }),
    message('viernes', 'viernes-12', ANA, at(0, 12, 40), { text: '🥳🥳' }),
  ],
  'dev-ai': [
    message('dev-ai', 'dev-ai-01', ME, at(1, 22, 10), {
      text: 'The nightly build failed on the auth tests.',
    }),
    message('dev-ai', 'dev-ai-02', DEV_AI, at(1, 22, 11), {
      text: "On it. I'll reproduce the failure and report back.",
    }),
    message('dev-ai', 'dev-ai-03', DEV_AI, at(1, 22, 24), {
      card: progressCard('Reproducing the failure', 35),
    }),
    message('dev-ai', 'dev-ai-04', DEV_AI, at(1, 22, 31), {
      card: progressCard('Bisecting commits', 60, '12 commits left'),
    }),
    message('dev-ai', 'dev-ai-05', DEV_AI, at(1, 22, 40), {
      text: 'Found it: the token expiry check used the wrong clock.',
    }),
    message('dev-ai', 'dev-ai-06', DEV_AI, at(1, 22, 41), { card: APPROVAL }),
    message('dev-ai', 'dev-ai-07', ME, at(1, 22, 45), { text: 'Approved. Nice catch.' }),
    message('dev-ai', 'dev-ai-08', DEV_AI, at(0, 9, 5), {
      card: progressCard('Applying the fix and running the suite', 80),
    }),
    message('dev-ai', 'dev-ai-09', DEV_AI, at(0, 11, 4), { text: 'Tests pass. Merge?' }),
  ],
  'dev-team': [
    message('dev-team', 'dev-team-01', MARTA, at(1, 16, 40), { text: 'Sprint 14 is closed 🎉' }),
    message('dev-team', 'dev-team-02', DANI, at(1, 16, 42), { text: 'Nice. Deployed to staging?' }),
    message('dev-team', 'dev-team-03', ME, at(1, 16, 43), { text: 'Deployed and smoke-tested ✅' }),
    message('dev-team', 'dev-team-04', DEV_AI, at(1, 16, 50), {
      card: progressCard('Running integration tests', 64, '12 of 18 suites passed'),
    }),
    message('dev-team', 'dev-team-05', DEV_AI, at(1, 16, 52), {
      text: 'All green so far. I will report when it finishes.',
    }),
    message('dev-team', 'dev-team-06', RUBEN, at(0, 11, 0), {
      text: 'PR #41 is merged',
      replyTo: { id: 'dev-team-03', senderName: 'You', text: 'Deployed and smoke-tested ✅' },
    }),
    message('dev-team', 'dev-team-07', SOFIA, at(0, 11, 1), { text: '🎉' }),
    message('dev-team', 'dev-team-08', ME, at(0, 11, 1), { text: 'Great work everyone 👏' }),
    message('dev-team', 'dev-team-09', DANI, at(0, 11, 2), { text: 'PR #42 is ready for review' }),
  ],
  neighbors: [
    message('neighbors', 'neighbors-01', DIEGO, at(1, 19, 40), {
      text: 'Anyone else hearing the works at 7am?',
    }),
    message('neighbors', 'neighbors-02', MARTA, at(1, 19, 42), { text: 'Every single day 😴' }),
    message('neighbors', 'neighbors-03', DIEGO, at(0, 8, 55), {
      text: 'Reminder: the plumber comes at 9 tomorrow.',
    }),
    message('neighbors', 'neighbors-04', DIEGO, at(0, 8, 56), {
      text: 'Please move the bikes from the hallway.',
    }),
    message('neighbors', 'neighbors-05', LUIS, at(0, 9, 1), { text: 'On it' }),
    message('neighbors', 'neighbors-06', DIEGO, at(0, 9, 2), { text: 'Thanks 🙏' }),
  ],
  sara: [
    message('sara', 'sara-01', SARA, at(1, 21, 50), { text: 'Did you see the game?' }),
    message('sara', 'sara-02', ME, at(1, 21, 52), { text: "Don't tell me the score!" }),
    message('sara', 'sara-03', SARA, at(1, 22, 9), { text: 'haha 😂 we lost anyway' }),
    message('sara', 'sara-04', SARA, at(1, 22, 10), { text: 'Ok, say nothing' }),
  ],
  'marketing-ai': [
    message('marketing-ai', 'marketing-ai-01', ME, at(3, 15, 0), {
      text: 'Draft three taglines for the launch.',
    }),
    message('marketing-ai', 'marketing-ai-02', MARKETING_AI, at(3, 15, 2), {
      text: '1) People and AIs, together. 2) Your team, human and otherwise. 3) Chat that works for both halves of your brain.',
    }),
    message('marketing-ai', 'marketing-ai-03', ME, at(3, 15, 10), { text: 'Love #1.' }),
    message('marketing-ai', 'marketing-ai-04', MARKETING_AI, at(1, 17, 18), {
      text: 'I scheduled the post for Monday at 9:00.',
    }),
    message('marketing-ai', 'marketing-ai-05', ME, at(1, 17, 20), { text: 'Thanks! 👌' }),
    // A rich AI reply for the Markdown rendering check (T-0064): heading, bold,
    // italic, bullet list, code block, quote and a link.
    message('marketing-ai', 'marketing-ai-06', MARKETING_AI, at(0, 9, 30), {
      text: [
        '## Launch checklist',
        '',
        'Here is the **short version** — the *hero* copy is the only open item:',
        '',
        '- finalise the tagline',
        '- review the landing page',
        '- schedule the post',
        '',
        '```ts',
        'export const launch = () => "go";',
        '```',
        '',
        '> Reply with a ✅ once you are happy.',
        '',
        'Full brief: https://galena.test/launch',
      ].join('\n'),
    }),
  ],
  family: [
    message('family', 'family-01', PAPA, at(3, 12, 0), {
      text: 'The photos from the trip arrived.',
    }),
    message('family', 'family-02', MAMA, at(3, 12, 5), { text: 'Send them to the group!' }),
    message('family', 'family-03', PAPA, at(3, 12, 30), {
      image: { url: gradientImage('garden'), width: 1200, height: 900 },
    }),
    message('family', 'family-04', ME, at(3, 12, 32), { text: 'Beautiful 😍' }),
    message('family', 'family-05', MAMA, at(2, 19, 0), {
      text: 'Dinner at ours on Sunday 🥘',
      replyTo: { id: 'family-04', senderName: 'You', text: 'Beautiful 😍' },
    }),
    message('family', 'family-06', ME, at(2, 19, 5), { text: 'Count me in' }),
    message('family', 'family-07', MAMA, at(2, 19, 6), { text: 'Call me when you can 💚' }),
  ],
  design: [
    message('design', 'design-01', MARTA, at(12, 10, 0), {
      text: 'Updated Figma with the new design tokens.',
    }),
    message('design', 'design-02', ME, at(12, 10, 2), { text: 'Nice, reviewing now' }),
    message('design', 'design-03', RUBEN, at(12, 10, 30), {
      text: 'The bubble tails look great 👌',
    }),
    message('design', 'design-04', MARTA, at(12, 10, 31), { text: 'Ship it 🚀' }),
    message('design', 'design-05', ME, at(12, 10, 33), { text: 'Merging now', status: 'sent' }),
  ],
  luis: [
    message('luis', 'luis-01', LUIS, at(40, 14, 0), { text: "Long time! How's Galena going?" }),
    message('luis', 'luis-02', ME, at(40, 14, 5), { text: 'Busy but good. Beer next week?' }),
    message('luis', 'luis-03', LUIS, at(40, 14, 6), { text: 'Anytime' }),
  ],
};
