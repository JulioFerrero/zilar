import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  alreadyPassedKey,
  hasPassRecord,
  MAX_PASS_RECORDS,
  pruneOldestRecords,
  treeKey,
  writePassRecord,
} from './pass-record.js';

// Every test works in its own temp folders; the real ~/.zilar-lead is never used.
let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pass-record-test-'));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function makeRepo(): string {
  const repo = path.join(scratch, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'work'));
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, 'work', 'T-1.md'), '# task\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return repo;
}

function setMtime(file: string, secondsAgo: number): void {
  const when = (Date.now() - secondsAgo * 1000) / 1000;
  fs.utimesSync(file, when, when);
}

describe('treeKey', () => {
  it('ignores work/ and counts uncommitted code changes', () => {
    const repo = makeRepo();
    const first = treeKey(repo);
    expect(first).toMatch(/^[0-9a-f]{40}$/);

    fs.writeFileSync(path.join(repo, 'work', 'T-1.md'), '# task, edited by the lead\n');
    expect(treeKey(repo)).toBe(first);

    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 2;\n');
    const changed = treeKey(repo);
    expect(changed).not.toBe(first);

    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    expect(treeKey(repo)).toBe(first);
  });

  it('counts a new untracked code file', () => {
    const repo = makeRepo();
    const first = treeKey(repo);
    fs.writeFileSync(path.join(repo, 'src', 'b.ts'), 'export const b = 1;\n');
    expect(treeKey(repo)).not.toBe(first);
  });

  it('leaves the real index of the repo untouched', () => {
    const repo = makeRepo();
    treeKey(repo);
    expect(execFileSync('git', ['ls-files', '--cached'], { cwd: repo, encoding: 'utf8' })).toBe('');
  });

  it('returns undefined outside a git repository', () => {
    const plain = path.join(scratch, 'plain');
    fs.mkdirSync(plain);
    expect(treeKey(plain)).toBeUndefined();
  });
});

describe('pass records', () => {
  it('writes an empty record into the injected folder and finds it', () => {
    const dir = path.join(scratch, 'gate-pass');
    expect(hasPassRecord(dir, 'abc123')).toBe(false);
    writePassRecord(dir, 'abc123');
    expect(hasPassRecord(dir, 'abc123')).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'abc123'), 'utf8')).toBe('');
  });

  it('keeps only the newest records when pruning', () => {
    const dir = path.join(scratch, 'gate-pass');
    fs.mkdirSync(dir);
    for (const [name, secondsAgo] of [
      ['oldest', 300],
      ['middle', 200],
      ['newest', 100],
    ] as const) {
      fs.writeFileSync(path.join(dir, name), '');
      setMtime(path.join(dir, name), secondsAgo);
    }
    pruneOldestRecords(dir, 2);
    expect(fs.readdirSync(dir).sort()).toEqual(['middle', 'newest']);
  });

  it('deletes the oldest record when a new one would go past the cap', () => {
    const dir = path.join(scratch, 'gate-pass');
    fs.mkdirSync(dir);
    for (let index = 0; index < MAX_PASS_RECORDS; index += 1) {
      const name = `old-${index}`;
      fs.writeFileSync(path.join(dir, name), '');
      setMtime(path.join(dir, name), 10_000 + index);
    }
    writePassRecord(dir, 'fresh');
    const names = fs.readdirSync(dir);
    expect(names).toHaveLength(MAX_PASS_RECORDS);
    expect(names).toContain('fresh');
    expect(names).not.toContain(`old-${MAX_PASS_RECORDS - 1}`);
    expect(names).toContain('old-0');
  });
});

describe('alreadyPassedKey', () => {
  it('returns the key when a record exists for the tree', () => {
    expect(
      alreadyPassedKey('/worktree', {
        treeKey: () => 'abc123',
        hasRecord: (key) => key === 'abc123',
      }),
    ).toBe('abc123');
  });

  it('returns undefined, so the gate runs, when no record exists', () => {
    expect(
      alreadyPassedKey('/worktree', { treeKey: () => 'abc123', hasRecord: () => false }),
    ).toBeUndefined();
  });

  it('returns undefined, and does not look for a record, when the key is unknown', () => {
    const asked: string[] = [];
    expect(
      alreadyPassedKey('/worktree', {
        treeKey: () => undefined,
        hasRecord: (key) => {
          asked.push(key);
          return true;
        },
      }),
    ).toBeUndefined();
    expect(asked).toEqual([]);
  });
});
