import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyState, loadState, saveState, stateFilePath, updateState } from './state';
import { newTaskRecord } from './types';

const ENV_KEY = 'ZILAR_LEAD_STATE';
const saved = process.env[ENV_KEY];

afterEach(() => {
  if (saved === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = saved;
  }
});

describe('state file', () => {
  it('defaults outside the repo and honors the override', () => {
    delete process.env[ENV_KEY];
    expect(stateFilePath()).toContain('.zilar-lead');
    process.env[ENV_KEY] = '/tmp/custom-state.json';
    expect(stateFilePath()).toBe('/tmp/custom-state.json');
  });

  it('round-trips records', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-state-'));
    const file = path.join(dir, 'state.json');
    const state = emptyState();
    state.tasks['T-0038'] = newTaskRecord({
      task: 'T-0038',
      sessionId: 'ses_x',
      worktree: '/tmp/w',
      model: 'opencode-go/muse-spark-1.3-contributor',
      role: 'worker',
      startedAt: '2026-09-28T00:00:00.000Z',
    });
    saveState(file, state);
    const loaded = loadState(file);
    expect(loaded.tasks['T-0038']?.sessionId).toBe('ses_x');
    expect(loaded.tasks['T-0038']?.nudgesSent).toBe(0);
    expect(loaded.tasks['T-0038']?.escalatedPermissionIds).toEqual([]);
  });

  it('loads empty when the file is missing', () => {
    expect(loadState('/tmp/lead-state-does-not-exist-12345.json').tasks).toEqual({});
  });

  it('updateState starts from the empty state when the file is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-state-'));
    const file = path.join(dir, 'state.json');
    const updated = updateState(file, (state) => {
      state.tasks['T-0038'] = newTaskRecord({
        task: 'T-0038',
        sessionId: 'ses_x',
        worktree: '/tmp/w',
        model: 'opencode-go/muse-spark-1.3-contributor',
        role: 'worker',
        startedAt: '2026-09-28T00:00:00.000Z',
      });
    });
    expect(updated.tasks['T-0038']?.sessionId).toBe('ses_x');
    expect(loadState(file).tasks['T-0038']?.sessionId).toBe('ses_x');
  });

  it('rejects a corrupt state file instead of guessing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-state-'));
    const file = path.join(dir, 'state.json');
    fs.writeFileSync(file, '{"version": 2, "tasks": {}}');
    expect(() => loadState(file)).toThrow(/invalid state file/);
  });
});
