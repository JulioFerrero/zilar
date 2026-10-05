import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeOpenCodeClient } from './client';
import { PREREVIEW_MODEL, startPrereviewSession } from './start-prereview.js';
import { promptsDir } from './prompts';

const HEAD = 'a'.repeat(40);

function makeWorktree(): { worktree: string; taskFile: string } {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-prereview-'));
  const workDir = path.join(worktree, 'work');
  fs.mkdirSync(workDir, { recursive: true });
  const taskFile = `T-0215-review-model-override.md`;
  fs.writeFileSync(
    path.join(workDir, taskFile),
    `---\nid: T-0215\ntitle: x\nstatus: in-progress\nmilestone: x\nbranch: task/T-0215\nmodel: opencode/x\ndepends_on: []\nestimate: 0.1 day\n---\n`,
  );
  return { worktree, taskFile };
}

describe('PREREVIEW_MODEL', () => {
  it('points at the free Muse listing', () => {
    expect(PREREVIEW_MODEL).toEqual({
      providerID: 'opencode',
      id: 'muse-spark-1.3-contributor-free',
    });
  });
});

describe('startPrereviewSession review-model override', () => {
  const previous = process.env.ZILAR_REVIEW_MODEL;

  beforeEach(() => {
    delete process.env.ZILAR_REVIEW_MODEL;
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.ZILAR_REVIEW_MODEL;
    } else {
      process.env.ZILAR_REVIEW_MODEL = previous;
    }
  });

  it('creates the session with the override when ZILAR_REVIEW_MODEL is set', async () => {
    process.env.ZILAR_REVIEW_MODEL = 'meta/muse-spark-1.3-contributor';
    const { worktree } = makeWorktree();
    const client = new FakeOpenCodeClient();
    const sessionId = await startPrereviewSession(
      { client, promptsDirPath: promptsDir(), worktree, task: 'T-0215' },
      HEAD,
    );
    expect(client.created).toHaveLength(1);
    expect(client.created[0]?.options.model).toEqual({
      providerID: 'meta',
      id: 'muse-spark-1.3-contributor',
    });
    expect(client.created[0]?.sessionId).toBe(sessionId);
  });
});
