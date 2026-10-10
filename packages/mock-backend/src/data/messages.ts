// A representative part of the old web message seed (`apps/web/src/mock/
// messages.ts`), keyed by chat JID and re-expressed with sender JIDs. It is a
// subset per chat — enough to scroll — because HTTP does not serve messages:
// the fake XMPP core (plan task F2) replays these. Timestamps are relative
// (`minutesAgo`), so `createSeed` can date them against its clock.

export interface MockMessageSeed {
  readonly id: string;
  readonly senderJid: string;
  readonly senderName: string;
  readonly minutesAgo: number;
  readonly text: string;
}

interface Sender {
  readonly jid: string;
  readonly name: string;
}

function sender(jid: string, name: string): Sender {
  return { jid, name };
}

const YOU = sender('you@zilar.test', 'You');
const ANA = sender('ana@zilar.test', 'Ana');
const LUIS = sender('luis@zilar.test', 'Luis');
const MARTA = sender('marta@zilar.test', 'Marta');
const MARCO = sender('marco@zilar.test', 'Marco');
const SOFIA = sender('sofia@zilar.test', 'Sofía');
const DEV1 = sender('dev-1@ai.zilar.test', 'Dev-1');
const QA1 = sender('qa-1@ai.zilar.test', 'QA-1');
const MARKETING = sender('marketing@ai.zilar.test', 'Marketing AI');

function m(id: string, from: Sender, minutesAgo: number, text: string): MockMessageSeed {
  return { id, senderJid: from.jid, senderName: from.name, minutesAgo, text };
}

export const messageSeeds: Readonly<Record<string, readonly MockMessageSeed[]>> = {
  'ana@zilar.test': [
    m('ana-1', ANA, 240, 'Hola! Are we still on for the concert?'),
    m('ana-2', YOU, 238, 'Yes! I got the tickets 🎉'),
    m('ana-3', ANA, 236, 'Amazing. Which entrance?'),
    m('ana-4', YOU, 230, 'The one by the river.'),
    m('ana-5', ANA, 228, 'Perfect, see you at 7.'),
    m('ana-6', ANA, 120, 'Sent you the playlist'),
    m('ana-7', YOU, 118, 'Listening now'),
  ],
  'acme@rooms.zilar.test': [
    m('acme-1', YOU, 600, 'Acme 2.4 is out: faster sync, quieter badges.'),
    m('acme-2', YOU, 590, 'Release notes and team news go here.'),
    m('acme-3', YOU, 300, 'Next maintenance window: Sunday 02:00 UTC.'),
  ],
  'dev-team@rooms.zilar.test': [
    m('dev-27', ANA, 300, 'Thanks everyone.'),
    m('dev-29', LUIS, 285, 'Release notes drafted in docs/CHANGELOG.md.'),
    m('dev-30', MARCO, 270, 'Tests pass. Merge?'),
    m('dev-31', DEV1, 260, '@You can you review the checkout fix before I merge?'),
  ],
  'viernes@rooms.zilar.test': [
    m('vie-22', LUIS, 400, 'On my way'),
    m('vie-23', MARTA, 390, 'Bringing a friend, she is in town'),
    m('vie-26', ANA, 380, 'Table for six then'),
    m('vie-27', MARCO, 370, 'Noted 🍻'),
  ],
  'dev-1@ai.zilar.test': [
    m('dai-3', DEV1, 200, 'PR #42 looks good. Two nits in the tests.'),
    m('dai-4', YOU, 198, 'Go ahead and fix them.'),
    m('dai-5', DEV1, 195, 'Done. Pushed a commit.'),
    m('dai-6', DEV1, 190, 'Tests pass. Merge?'),
  ],
  'marta@zilar.test': [
    m('mar-1', MARTA, 500, 'Did you get the file I sent?'),
    m('mar-2', YOU, 498, 'Yes, thanks!'),
    m('mar-3', MARTA, 495, 'Great, let me know if it opens.'),
  ],
  'familia@rooms.zilar.test': [
    m('fam-2', SOFIA, 720, 'Mum is making paella 🥘'),
    m('fam-3', YOU, 715, "I'll be there"),
    m('fam-4', MARCO, 710, 'Bring the kids!'),
    m('fam-5', MARTA, 700, 'And a dessert 🍰'),
    m('fam-6', LUIS, 690, "Also, who's driving?"),
    m('fam-7', ANA, 680, 'Hello? 😅'),
  ],
  'qa@rooms.zilar.test': [
    m('qa-1', QA1, 330, 'Running the regression suite.'),
    m('qa-3', QA1, 320, '3 failures, all in checkout.'),
    m('qa-4', YOU, 318, 'On it.'),
    m('qa-5', QA1, 300, 'Fixed in the latest build.'),
  ],
  'luis@zilar.test': [
    m('lui-1', LUIS, 900, 'Did you watch the match?'),
    m('lui-2', YOU, 898, 'Only the highlights.'),
    m('lui-3', LUIS, 895, 'Unreal finish ⚽'),
  ],
  'marketing@ai.zilar.test': [
    m('mai-1', YOU, 260, 'Draft a launch post for the beta.'),
    m('mai-2', MARKETING, 258, 'Here are three options.'),
    m('mai-3', MARKETING, 256, 'Option A is the punchiest, in my opinion.'),
    m('mai-4', YOU, 250, 'Option A it is.'),
  ],
  'gym@rooms.zilar.test': [
    m('gym-1', MARCO, 1100, 'Leg day tomorrow?'),
    m('gym-2', YOU, 1098, 'Never skip leg day'),
    m('gym-3', MARCO, 1095, "That's the spirit 💪"),
  ],
  'product@rooms.zilar.test': [
    m('pro-1', ANA, 1000, 'Roadmap review moved to Thursday.'),
    m('pro-2', YOU, 998, 'Works for me.'),
  ],
};
