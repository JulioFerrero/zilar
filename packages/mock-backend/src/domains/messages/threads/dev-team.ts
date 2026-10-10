// The Dev team room (`dev-team@rooms.zilar.test`), web's `c-devteam`: the
// checkout-fix storyline with the Dev AI's progress cards and the approval.
import { approvalCard, image, progressCard, voice } from '../builders';
import { ago, JIDS, msg, type MockMessageSeed } from './shared';

const { you: YOU, ana: ANA, luis: LUIS, marco: MARCO, dev1: DEV1 } = JIDS;

export const devTeamMessages: readonly MockMessageSeed[] = [
  msg('dev-1', DEV1, ago(3, 9, 2), {
    body: 'Morning all — I picked up T-17 (checkout button on mobile).',
  }),
  msg('dev-2', ANA, ago(3, 9, 5), { body: 'Thanks! It only breaks on iOS Safari.' }),
  msg('dev-3', ANA, ago(3, 9, 6), { body: 'Repro steps are in the ticket.' }),
  msg('dev-4', YOU, ago(3, 9, 10), { body: 'Dev-1, can you draft a fix and a test?' }),
  msg('dev-5', DEV1, ago(3, 9, 11), {
    payload: progressCard({
      stage: 'Cloning repository',
      detail: 'shallow clone of acme/shop',
      taskId: 't-17',
    }),
  }),
  msg('dev-6', DEV1, ago(3, 9, 14), {
    payload: progressCard({ stage: 'Running tests', percent: 33, taskId: 't-17' }),
  }),
  msg('dev-7', DEV1, ago(3, 9, 20), {
    body: 'Found it: the sticky footer covers the button on iOS 17.',
  }),
  msg('dev-8', LUIS, ago(3, 9, 25), {
    body: 'Nice catch. Same on Android?',
    replyTo: { id: 'dev-7' },
  }),
  msg('dev-9', DEV1, ago(3, 9, 27), {
    body: 'Android is fine. Only the safe-area inset on iOS.',
    replyTo: { id: 'dev-8' },
  }),
  msg('dev-10', ANA, ago(3, 9, 40), { body: "😂 of course it's Safari again" }),
  msg('dev-11', YOU, ago(3, 9, 42), { body: "Ship it behind a flag if it's risky." }),
  msg('dev-12', DEV1, ago(2, 14, 5), { payload: image('#82b1ff', '#665fff', 'Checkout fix') }),
  msg('dev-13', DEV1, ago(2, 14, 6), { body: 'Preview build is up for review.' }),
  msg('dev-14', ANA, ago(2, 14, 20), {
    payload: voice(12_000, 303, 'I checked it on my iPhone, the button is reachable now.'),
  }),
  msg('dev-15', YOU, ago(2, 14, 22), { body: 'Listened, thanks 🙏' }),
  msg('dev-16', LUIS, ago(2, 14, 30), { body: 'Left a comment on the PR.' }),
  msg('dev-17', DEV1, ago(2, 15, 0), {
    payload: progressCard({ stage: 'Running e2e tests', percent: 80, taskId: 't-17' }),
  }),
  msg('dev-18', DEV1, ago(2, 15, 5), { body: 'All green. PR #42 is ready for review.' }),
  msg('dev-19', ANA, ago(1, 10, 12), { body: 'Approved ✅' }),
  msg('dev-20', YOU, ago(1, 10, 15), { body: 'Merging after lunch.' }),
  msg('dev-21', DEV1, ago(1, 10, 16), { payload: approvalCard() }),
  msg('dev-22', LUIS, ago(1, 15, 30), { body: 'Deployed to staging.' }),
  msg('dev-23', ANA, ago(1, 15, 31), { body: 'Nice' }),
  msg('dev-24', MARCO, ago(0, 9, 50), { body: 'Footer no longer covers the button 🎉' }),
  msg('dev-25', ANA, ago(0, 9, 52), { body: 'Tested on iPhone 12 and 15, both fine.' }),
  msg('dev-26', ANA, ago(0, 9, 53), { body: 'Also checked landscape.' }),
  msg('dev-27', YOU, ago(0, 10, 0), { body: 'Thanks everyone.' }),
  msg('dev-28', DEV1, ago(0, 10, 30), {
    payload: progressCard({ stage: 'Writing release notes', taskId: 't-17' }),
  }),
  msg('dev-29', DEV1, ago(0, 10, 32), { body: 'Release notes drafted in docs/CHANGELOG.md.' }),
  msg('dev-31', LUIS, ago(0, 11, 0), {
    body: '@You can you review the checkout fix before I merge?',
    mentions: [{ jid: JIDS.you, begin: 0, end: 4 }],
  }),
  msg('dev-32', DEV1, ago(0, 11, 1), {
    body: [
      '## Checkout fix ready',
      '',
      'I pushed **PR #42** with a `safe-area` guard. Summary:',
      '',
      '- iOS 17: button reachable',
      '- Android: unchanged',
      '',
      'Run it with `pnpm test:e2e`.',
    ].join('\n'),
  }),
  msg('dev-30', DEV1, ago(0, 11, 2), { body: 'Tests pass. Merge?' }),
];
