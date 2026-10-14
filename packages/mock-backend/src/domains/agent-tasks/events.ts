// T-1426: the scripted session log the mock serves for the Dev AI's "Writing
// release notes" card (`domains/messages/threads/dev-team.ts`), so the task G
// "View steps" UI has data without a live server.
const RELEASE_NOTES_TASK_ID = 'task-release-notes';

export { RELEASE_NOTES_TASK_ID as MOCK_RELEASE_NOTES_TASK_ID };

export interface MockTaskEvent {
  id: string;
  seq: number;
  kind: 'status' | 'model_call' | 'tool_call' | 'tool_result' | 'answer' | 'error' | 'approval';
  at: string;
  durationMs: number | null;
  data: Record<string, unknown>;
}

function at(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

// A short, ordered list: a status, one tool call and its result, a model call,
// then the answer. `seq` is the cursor.
const RELEASE_NOTES_EVENTS: readonly MockTaskEvent[] = [
  {
    id: 'evt-rel-1',
    seq: 1,
    kind: 'status',
    at: at(3),
    durationMs: null,
    data: { stage: 'Collecting the merged pull requests' },
  },
  {
    id: 'evt-rel-2',
    seq: 2,
    kind: 'tool_call',
    at: at(3),
    durationMs: null,
    data: { tool: 'git_log', args: '--oneline -20', args_bytes: 12 },
  },
  {
    id: 'evt-rel-3',
    seq: 3,
    kind: 'tool_result',
    at: at(3),
    durationMs: 140,
    data: {
      tool: 'git_log',
      output: 'fix: keep the checkout button above the sticky footer (#42)',
      output_bytes: 60,
      ok: true,
      exit_code: 0,
    },
  },
  {
    id: 'evt-rel-4',
    seq: 4,
    kind: 'model_call',
    at: at(2),
    durationMs: 820,
    data: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      input_tokens: 1180,
      output_tokens: 340,
      cost_usd: 0.0042,
      ok: true,
    },
  },
  {
    id: 'evt-rel-5',
    seq: 5,
    kind: 'answer',
    at: at(2),
    durationMs: null,
    data: { bytes: 210 },
  },
];

/** One page of the scripted events for a task id, or null for an unknown task. */
export function mockTaskEvents(
  taskId: string,
  after: number,
  limit: number,
): { events: MockTaskEvent[]; next: number | null } | null {
  if (taskId !== RELEASE_NOTES_TASK_ID) {
    return null;
  }
  const page = RELEASE_NOTES_EVENTS.filter((event) => event.seq > after).slice(0, limit);
  const next = page.length === limit ? (page[page.length - 1]?.seq ?? null) : null;
  return { events: [...page], next };
}
