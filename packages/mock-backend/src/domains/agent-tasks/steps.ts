// T-1535: the scripted "View steps" answer the mock serves for the Dev AI's
// finished "Reviewing the open PRs" card (`domains/messages/threads/dev-ai.ts`,
// task `t-21`). One row per card step, each with the actions logged under it;
// step 2 holds the failed `pnpm test` and step 1 was approved. Durations sum to
// the card's 2:14 total. An unknown task id answers the same 404 the server
// does.
export interface MockTaskStepAction {
  command: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface MockTaskStep {
  id: string;
  label: string;
  state: 'done' | 'failed' | 'stopped' | 'doing';
  durationMs: number;
  approved: boolean;
  actions: MockTaskStepAction[];
}

export interface MockTaskSteps {
  steps: MockTaskStep[];
}

const REVIEW_TASK_ID = 't-21';

const REVIEW_STEPS: readonly MockTaskStep[] = [
  {
    id: 'rev-1',
    label: 'Read both pull requests',
    state: 'done',
    durationMs: 48_000,
    approved: true,
    actions: [
      { command: 'git diff origin/main', ok: true, durationMs: 12_000 },
      { command: 'gh pr list --limit 20', ok: true, durationMs: 36_000 },
    ],
  },
  {
    id: 'rev-2',
    label: 'Run the test suites',
    state: 'failed',
    durationMs: 51_000,
    approved: false,
    actions: [
      {
        command: 'pnpm test',
        ok: false,
        durationMs: 41_000,
        error: 'FAIL  checkout.spec.ts\n  expected retry after 3 attempts, got 1',
      },
      { command: 'pnpm test --filter web', ok: true, durationMs: 10_000 },
    ],
  },
  {
    id: 'rev-3',
    label: 'Check the bundle size',
    state: 'done',
    durationMs: 20_000,
    approved: false,
    actions: [{ command: 'pnpm build --report', ok: true, durationMs: 20_000 }],
  },
  {
    id: 'rev-4',
    label: 'Write the review summary',
    state: 'done',
    durationMs: 15_000,
    approved: false,
    actions: [{ command: 'write review summary', ok: true, durationMs: 15_000 }],
  },
];

/** The scripted steps for a task id, or null for an unknown task. */
export function mockTaskSteps(taskId: string): MockTaskSteps | null {
  if (taskId !== REVIEW_TASK_ID) {
    return null;
  }
  return { steps: REVIEW_STEPS.map((step) => ({ ...step, actions: [...step.actions] })) };
}
