import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tickOnce, type AutopilotDeps } from './autopilot.js';
import { FakeOpenCodeClient } from './client.js';
import { GO_DEEPSEEK_FLASH } from './models.js';
import { promptsDir } from './prompts.js';
import { saveState } from './state.js';
import { newTaskRecord } from './types.js';

const TASK = 'T-9001';

// A `model: auto` task whose front matter pins `effort: low`. Auto resolution
// overrides that to `default` (the free listing needs it), so any in-place
// switch must keep `default`, never fall back to the raw `low` (T-1242 finding 1).
function taskFile(): string {
  return [
    '---',
    `id: ${TASK}`,
    'title: Demo',
    'status: in-progress',
    'milestone: tooling',
    `branch: task/${TASK}-demo`,
    'model: auto',
    'effort: low',
    'depends_on: []',
    'estimate: 0.2 day',
    '---',
    '',
  ].join('\n');
}

// One worker session that ended on a provider quota error. Both the repo root
// (for readTaskFrontMatter) and the worktree (for readTaskInfo) get the task
// file. The fake git runner reports no HEAD, which keeps the doctor step and
// the pre-review step out of the way.
function setup(): { deps: AutopilotDeps; client: FakeOpenCodeClient } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-autopilot-'));
  const repoRoot = path.join(dir, 'zilar');
  const worktree = path.join(dir, `zilar-${TASK}`);
  for (const root of [repoRoot, worktree]) {
    fs.mkdirSync(path.join(root, 'work'), { recursive: true });
    fs.writeFileSync(path.join(root, 'work', `${TASK}-demo.md`), taskFile());
  }
  const statePath = path.join(dir, 'state.json');
  const client = new FakeOpenCodeClient();
  const sessionId = 'ses_worker';
  client.addSession(sessionId, {
    messages: [{ type: 'error', error: { type: 'provider.quota' }, time: { created: 1 } }],
    permissions: [],
  });
  saveState(statePath, {
    version: 1,
    tasks: {
      [TASK]: newTaskRecord({
        task: TASK,
        sessionId,
        worktree,
        model: GO_DEEPSEEK_FLASH,
        role: 'worker',
        startedAt: '2026-10-12T00:00:00.000Z',
      }),
    },
    doctor: undefined,
  });
  const runner = { run: (): { ok: boolean; stdout: string } => ({ ok: false, stdout: '' }) };
  return {
    deps: { client, runner, statePath, promptsDirPath: promptsDir(), repoRoot },
    client,
  };
}

describe('tickOnce worker fallback keeps the resolved variant (T-1242)', () => {
  it('moves a quota-hit auto worker from the Go listing to the DeepSeek API at variant default, not the raw effort', async () => {
    const { deps, client } = setup();
    await tickOnce(deps, { dryRun: false, now: Date.now() });
    expect(client.switched).toEqual([
      {
        sessionId: 'ses_worker',
        model: { providerID: 'deepseek', id: 'deepseek-flash', variant: 'default' },
      },
    ]);
  });
});
