import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGitCache, parseMergedLog, readWorktreeGit, saveGitCache } from './collect-snapshot';
import type { GitResult, GitRunner } from './git';

describe('parseMergedLog', () => {
  it('parses a squash-merge subject', () => {
    const out = parseMergedLog('1700000000|T-0205: dashboard merged today after squash');
    expect(out).toEqual([{ id: 'T-0205', time: '2023-11-14T22:13:20.000Z' }]);
  });

  it('parses the old board subject', () => {
    const out = parseMergedLog('1700000000|board: T-0205 merged');
    expect(out).toEqual([{ id: 'T-0205', time: '2023-11-14T22:13:20.000Z' }]);
  });

  it('ignores lines that do not look like a merge', () => {
    const out = parseMergedLog('1700000000|work: T-0200 spec, playbook squash note, NOW');
    expect(out).toEqual([]);
  });

  it('returns one entry when the same task appears twice', () => {
    const out = parseMergedLog(
      ['1700000100|T-0205: newest squash subject', '1700000000|board: T-0205 merged'].join('\n'),
    );
    expect(out).toEqual([{ id: 'T-0205', time: '2023-11-14T22:15:00.000Z' }]);
  });

  it('returns [] for an empty input', () => {
    expect(parseMergedLog('')).toEqual([]);
  });
});

function countingRunner(calls: string[], status = ''): GitRunner {
  return {
    run(_cwd: string, args: string[]): GitResult {
      calls.push(args[0] ?? '');
      if (args[0] === 'rev-parse') {
        return { ok: true, stdout: `${'b'.repeat(40)}\n` };
      }
      if (args[0] === 'status') {
        return { ok: true, stdout: status };
      }
      if (args[0] === 'merge-base') {
        return { ok: true, stdout: 'abc123\n' };
      }
      if (args[0] === 'diff') {
        return { ok: true, stdout: 'M\tlead/watch.ts\n' };
      }
      if (args[0] === 'log') {
        return { ok: true, stdout: '1700000000\n' };
      }
      if (args[0] === 'rev-list') {
        return { ok: true, stdout: '3\n' };
      }
      return { ok: false, stdout: '' };
    },
  };
}

describe('readWorktreeGit', () => {
  it('reuses the cached git results when HEAD and status are unchanged', () => {
    const cache = new Map();
    const calls: string[] = [];
    const runner = countingRunner(calls);
    const first = readWorktreeGit(runner, '/wt', cache);
    expect(calls).toHaveLength(6);
    expect(first.head).toBe('b'.repeat(40));
    expect(first.commitMs).toBe(1_700_000_000_000);
    expect(first.commits).toBe(3);
    expect(first.ok).toBe(true);
    calls.length = 0;
    const second = readWorktreeGit(runner, '/wt', cache);
    expect(calls).toEqual(['rev-parse', 'status']);
    expect(second).toBe(first);
  });

  it('recomputes when the porcelain status changes', () => {
    const cache = new Map();
    const calls: string[] = [];
    readWorktreeGit(countingRunner(calls), '/wt', cache);
    calls.length = 0;
    readWorktreeGit(countingRunner(calls, '?? new.ts\n'), '/wt', cache);
    expect(calls).toContain('merge-base');
    expect(calls).toContain('diff');
  });
});

describe('git cache file', () => {
  it('round-trips through disk', () => {
    const file = path.join(os.tmpdir(), `watch-cache-${process.pid}-${Date.now()}.json`);
    const cache = new Map();
    const calls: string[] = [];
    readWorktreeGit(countingRunner(calls), '/wt', cache);
    try {
      saveGitCache(file, cache);
      const loaded = loadGitCache(file);
      expect(loaded.get('/wt')?.head).toBe('b'.repeat(40));
      expect(loaded.get('/wt')?.nameStatus).toBe('M\tlead/watch.ts\n');
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('returns an empty cache for a missing or malformed file', () => {
    expect(loadGitCache('/nonexistent/watch-cache.json').size).toBe(0);
    const file = path.join(os.tmpdir(), `watch-cache-bad-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(file, '{not json');
    try {
      expect(loadGitCache(file).size).toBe(0);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
