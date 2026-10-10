// The Dev AI DM (`dev-1@ai.zilar.test`), web's `c-devai`.
import { progressCard } from '../builders';
import { ago, JIDS, msg, type MockMessageSeed } from './shared';

const { you: YOU, dev1: DEV1 } = JIDS;

export const devAiMessages: readonly MockMessageSeed[] = [
  msg('dai-1', YOU, ago(1, 17, 50), { body: 'Can you review the open PRs?' }),
  msg('dai-2', DEV1, ago(1, 17, 51), { payload: progressCard({ stage: 'Reading pull requests' }) }),
  msg('dai-3', DEV1, ago(1, 18, 30), { body: 'PR #42 looks good. Two nits in the tests.' }),
  msg('dai-4', YOU, ago(1, 18, 33), { body: 'Go ahead and fix them.' }),
  msg('dai-5', DEV1, ago(1, 18, 40), { body: 'Done. Pushed a commit.' }),
  msg('dai-6', DEV1, ago(1, 18, 42), { body: 'Tests pass. Merge?' }),
  msg('dai-7', DEV1, ago(0, 18, 5), {
    body: [
      '## Review summary',
      '',
      'I read **both** PRs and left notes. The checkout fix is ready; the `retry` helper needs one more test.',
      '',
      '### What I checked',
      '',
      '- Build and typecheck: green',
      '- Unit tests: `142 passed`',
      '  - one flaky test in `checkout.spec.ts`',
      '- Bundle size: unchanged',
      '',
      'Run the suite locally with:',
      '',
      '```bash',
      'pnpm --filter @zilar/web exec vitest run --coverage --reporter=verbose --pool=vmThreads --maxWorkers=4',
      '```',
      '',
      '| Change | Risk | Notes |',
      '| --- | --- | --- |',
      '| Sticky footer | Low | iOS safe-area only |',
      '| Retry helper | Medium | needs a timeout test |',
      '',
      '> The retry helper is the only thing I would not merge today.',
      '',
      'Details are in [the review](https://example.com/reviews/42).',
    ].join('\n'),
  }),
];
