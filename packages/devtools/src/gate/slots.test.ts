import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { claimPid, release, tryAcquire } from './slots.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zilar-slots-'));
  tempDirs.push(dir);
  return dir;
}

function pidOf(dir: string, name: string): string {
  return fs.readFileSync(path.join(dir, name, 'pid'), 'utf8').trim();
}

const names = ['w1', 'w2'];

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('tryAcquire', () => {
  it('gives the first two takers w1 and w2 and nothing to the third', () => {
    const dir = tempDir();
    expect(tryAcquire(dir, names, { pid: 1, isAlive: () => true })).toBe('w1');
    expect(tryAcquire(dir, names, { pid: 2, isAlive: () => true })).toBe('w2');
    expect(tryAcquire(dir, names, { pid: 3, isAlive: () => true })).toBeUndefined();
    expect(pidOf(dir, 'w1')).toBe('1');
    expect(pidOf(dir, 'w2')).toBe('2');
  });

  it('reclaims a slot whose pid is no longer alive', () => {
    const dir = tempDir();
    expect(tryAcquire(dir, ['w1'], { pid: 111, isAlive: () => true })).toBe('w1');
    const got = tryAcquire(dir, ['w1'], {
      pid: 222,
      isAlive: (pid) => pid !== 111,
      now: () => 1,
    });
    expect(got).toBe('w1');
    expect(pidOf(dir, 'w1')).toBe('222');
  });

  it('keeps merge independent of w1 and w2', () => {
    const dir = tempDir();
    expect(tryAcquire(dir, names, { pid: 1, isAlive: () => true })).toBe('w1');
    expect(tryAcquire(dir, names, { pid: 2, isAlive: () => true })).toBe('w2');
    expect(tryAcquire(dir, ['merge'], { pid: 3, isAlive: () => true })).toBe('merge');
  });

  it('does not reclaim a slot whose pid appears between the liveness check and the rename', () => {
    const dir = tempDir();
    const slot = path.join(dir, 'w1');
    fs.mkdirSync(slot);
    fs.writeFileSync(path.join(slot, 'pid'), '111\n');
    let calls = 0;
    const got = tryAcquire(dir, ['w1'], {
      pid: 222,
      isAlive: () => {
        calls += 1;
        if (calls === 1) {
          // The first read saw 111 as dead, but a live owner (222) wrote its
          // pid before we moved the directory aside.
          fs.writeFileSync(path.join(slot, 'pid'), '222\n');
          return false;
        }
        return true;
      },
      now: () => 1,
    });
    expect(got).toBeUndefined();
    expect(pidOf(dir, 'w1')).toBe('222');
  });
});

describe('claimPid', () => {
  it('writes the pid once and refuses to overwrite an existing claim', () => {
    const dir = tempDir();
    const slot = path.join(dir, 'w1');
    fs.mkdirSync(slot);
    expect(claimPid(slot, 5)).toBe(true);
    expect(pidOf(dir, 'w1')).toBe('5');
    expect(claimPid(slot, 6)).toBe(false);
    expect(pidOf(dir, 'w1')).toBe('5');
  });
});

describe('release', () => {
  it('frees the slot for the next taker', () => {
    const dir = tempDir();
    expect(tryAcquire(dir, names, { pid: 1, isAlive: () => true })).toBe('w1');
    release(dir, 'w1');
    expect(fs.existsSync(path.join(dir, 'w1'))).toBe(false);
    expect(tryAcquire(dir, names, { pid: 2, isAlive: () => true })).toBe('w1');
  });
});
