import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tickOnce, type AutopilotDeps } from './autopilot.js';
import { FakeOpenCodeClient } from './client.test-support.js';
import { fallbackModel } from './fallback.js';
import {
  FREE_PAUSE_HOURS,
  freePause,
  isFreeListing,
  isFreePaused,
  paidStep,
  pauseFree,
  pauseFreeOnRefusal,
} from './free-pause.js';
import { FREE_DEEPSEEK_FLASH, FREE_MUSE, GO_DEEPSEEK_FLASH, GO_MUSE, PAID_MUSE } from './models.js';
import { promptsDir } from './prompts.js';
import { summarizeSession } from './session.js';
import { saveState } from './state.js';
import { newTaskRecord } from './types.js';

const NOW = new Date('2026-10-18T12:00:00.000Z');
// Tests set ZILAR_LEAD_CONFIG; keep the value the developer started with.
const savedConfig = process.env['ZILAR_LEAD_CONFIG'];

function writeConfig(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-free-pause-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, contents);
  return file;
}

describe('freePause', () => {
  it('pauses before the timestamp and not on or after it', () => {
    const file = writeConfig('{ "freePausedUntil": "2026-10-18T18:00:00.000Z" }');
    expect(freePause(new Date('2026-10-18T17:59:59.000Z'), file)).toEqual({
      until: '2026-10-18T18:00:00.000Z',
    });
    expect(isFreePaused(new Date('2026-10-18T17:59:59.000Z'), file)).toBe(true);
    expect(isFreePaused(new Date('2026-10-18T18:00:00.000Z'), file)).toBe(false);
    expect(isFreePaused(new Date('2026-10-19T00:00:00.000Z'), file)).toBe(false);
  });

  it('is not paused without a config file or without the key', () => {
    expect(isFreePaused(NOW, path.join(os.tmpdir(), 'no-such-free-pause.json'))).toBe(false);
    expect(isFreePaused(NOW, writeConfig('{ "goPausedUntil": "2026-10-27" }'))).toBe(false);
  });

  it('ignores a malformed value and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const file = writeConfig('{ "freePausedUntil": "not-a-date" }');
    expect(isFreePaused(NOW, file)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('pauseFree', () => {
  it('writes until six hours out, keeps the other keys, and says so once', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const file = writeConfig('{ "goPausedUntil": "2026-10-27" }');
    const until = pauseFree(NOW, FREE_PAUSE_HOURS, 'free DeepSeek flash: Forbidden', file);
    expect(until).toBe('2026-10-18T18:00:00.000Z');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      goPausedUntil: '2026-10-27',
      freePausedUntil: until,
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toBe(
      `LEAD: FREE PAUSED until ${until} (free DeepSeek flash: Forbidden)`,
    );
    log.mockRestore();
  });

  it('does not pause again while the window is open', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const file = writeConfig('{ "freePausedUntil": "2026-10-18T18:00:00.000Z" }');
    expect(pauseFreeOnRefusal(NOW, FREE_DEEPSEEK_FLASH, 'Forbidden', file)).toBe(false);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('merges the pause back when another process replaces the file after ours', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const file = writeConfig('{ "goPausedUntil": "2026-10-27" }');
    const realRename = fs.renameSync;
    let replaceOnce = true;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      realRename(from, to);
      if (replaceOnce) {
        replaceOnce = false;
        fs.writeFileSync(to, '{ "goPausedUntil": "2026-11-01" }');
      }
    });
    const until = pauseFree(NOW, FREE_PAUSE_HOURS, 'Forbidden', file);
    spy.mockRestore();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      goPausedUntil: '2026-11-01',
      freePausedUntil: until,
    });
    log.mockRestore();
  });
});

describe('free listings', () => {
  it('names the three free listings and any other opencode(-go)/*-free', () => {
    expect(isFreeListing(FREE_DEEPSEEK_FLASH)).toBe(true);
    expect(isFreeListing(FREE_MUSE)).toBe(true);
    expect(isFreeListing('opencode/beam-free')).toBe(true);
    expect(isFreeListing('opencode-go/beam-free')).toBe(true);
    expect(isFreeListing('opencode-go/deepseek-v4.1-flash')).toBe(false);
    expect(isFreeListing(GO_DEEPSEEK_FLASH)).toBe(false);
    expect(isFreeListing('deepseek/deepseek-flash')).toBe(false);
  });

  it('gives every free listing a paid step, including an unmodelled one', () => {
    expect(paidStep(FREE_DEEPSEEK_FLASH, false)).toBe(GO_DEEPSEEK_FLASH);
    expect(paidStep(FREE_MUSE, false)).toBe(GO_MUSE);
    expect(paidStep(FREE_MUSE, true)).toBe(PAID_MUSE);
    expect(paidStep('opencode/beam-free', false)).toBe(GO_MUSE);
    expect(paidStep('opencode/beam-free', true)).toBe(PAID_MUSE);
    expect(paidStep(GO_MUSE, false)).toBe(PAID_MUSE);
  });

  it('falls back from an unmodelled free listing to the paid step', () => {
    expect(fallbackModel('opencode-go/beam-free', false, true)).toBe(GO_MUSE);
  });
});

// A free-listing session that the gateway refused with a 403: the autopilot must
// pause the free listings for six hours and move the worker onto the paid step.
const TASK = 'T-9002';

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

function setup(): { deps: AutopilotDeps; client: FakeOpenCodeClient; configPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-free-abuse-'));
  const repoRoot = path.join(dir, 'zilar');
  const worktree = path.join(dir, `zilar-${TASK}`);
  for (const root of [repoRoot, worktree]) {
    fs.mkdirSync(path.join(root, 'work'), { recursive: true });
    fs.writeFileSync(path.join(root, 'work', `${TASK}-demo.md`), taskFile());
  }
  const statePath = path.join(dir, 'state.json');
  const client = new FakeOpenCodeClient();
  client.addSession('ses_worker', {
    messages: [
      {
        type: 'error',
        status: 403,
        message: 'Forbidden, OpenCode Free Model Gateway Detect Abuse Traffic',
        time: { created: 1 },
      },
    ],
    permissions: [],
  });
  saveState(statePath, {
    version: 1,
    tasks: {
      [TASK]: newTaskRecord({
        task: TASK,
        sessionId: 'ses_worker',
        worktree,
        model: FREE_DEEPSEEK_FLASH,
        role: 'worker',
        startedAt: '2026-10-18T00:00:00.000Z',
      }),
    },
    doctor: undefined,
  });
  const runner = { run: (): { ok: boolean; stdout: string } => ({ ok: false, stdout: '' }) };
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, '{ "goPausedUntil": "2026-10-01" }');
  return {
    deps: { client, runner, statePath, promptsDirPath: promptsDir(), repoRoot },
    client,
    configPath,
  };
}

afterEach(() => {
  if (savedConfig === undefined) {
    delete process.env['ZILAR_LEAD_CONFIG'];
  } else {
    process.env['ZILAR_LEAD_CONFIG'] = savedConfig;
  }
});

describe('a 403 refusal on a free listing (T-1942)', () => {
  it('reads the refusal from the session messages', () => {
    const summary = summarizeSession([
      {
        type: 'error',
        status: 403,
        message: 'Forbidden, OpenCode Free Model Gateway Detect Abuse Traffic',
        time: { created: 1 },
      },
    ]);
    expect(summary.quotaError).toBe(true);
    expect(summary.freeRefusal).toBe('Forbidden, OpenCode Free Model Gateway Detect Abuse Traffic');
  });

  it('does not treat a messageless provider quota error as a refusal', () => {
    const summary = summarizeSession([{ type: 'error', error: { type: 'provider.quota' } }]);
    expect(summary.quotaError).toBe(true);
    expect(summary.freeRefusal).toBeUndefined();
    const file = writeConfig('{}');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(pauseFreeOnRefusal(NOW, FREE_DEEPSEEK_FLASH, summary.freeRefusal, file)).toBe(false);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('pauses free for six hours and moves the worker onto the paid step', async () => {
    const { deps, client, configPath } = setup();
    process.env['ZILAR_LEAD_CONFIG'] = configPath;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await tickOnce(deps, { dryRun: false, now: NOW.getTime() });
    expect(isFreePaused(NOW, configPath)).toBe(true);
    expect(client.switched).toEqual([
      {
        sessionId: 'ses_worker',
        model: { providerID: 'opencode-go', id: 'deepseek-v4.1-flash', variant: 'default' },
      },
    ]);
    log.mockRestore();
  });
});
