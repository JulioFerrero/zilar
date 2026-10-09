// The gate's slot lock: at most two worker gates run at once, plus one `merge`
// slot that never waits behind them. A slot is a directory under `dir` holding
// a `pid` file, created with `mkdirSync` so two gates racing for the same name
// cannot both win. A slot whose pid is no longer alive is stale; it is reclaimed
// by renaming it to a unique tombstone first, so only one waiter can take it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Where every worktree's gate slots live. */
export const gateSlotsDir = path.join(os.homedir(), '.zilar-lead', 'gate-slots');

export interface SlotDeps {
  /** The pid written into a slot this process claims. */
  pid: number;
  /** Whether a pid is still running; `process.kill(pid, 0)` throwing means it is not. */
  isAlive: (pid: number) => boolean;
  /** Milliseconds since the epoch; keeps a stale reclaim's tombstone name unique. */
  now: () => number;
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isEexist(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function readPid(file: string): number | undefined {
  try {
    const pid = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isInteger(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

// Claims the slot's pid file exclusively (`wx`): if another gate wrote it after
// we made the directory, our write fails and we lose. Reading the value back
// catches a directory that was reclaimed and re-created under us.
export function claimPid(slot: string, pid: number): boolean {
  const file = path.join(slot, 'pid');
  try {
    fs.writeFileSync(file, `${pid}\n`, { flag: 'wx' });
  } catch {
    return false;
  }
  return readPid(file) === pid;
}

// Renaming the stale slot is atomic: of the waiters that saw the same dead pid,
// only the one whose rename succeeds goes on to delete and re-create it.
function reclaim(dir: string, name: string, deps: SlotDeps): boolean {
  const slot = path.join(dir, name);
  const tombstone = path.join(dir, `${name}.stale.${deps.pid}.${deps.now()}`);
  try {
    fs.renameSync(slot, tombstone);
  } catch {
    return false;
  }
  // The owner's pid file may have appeared between our liveness read and the
  // rename (its mkdir won just before our read). Re-read it from the moved
  // directory: if it is alive now, the slot was not stale, so put it back.
  const owner = readPid(path.join(tombstone, 'pid'));
  if (owner !== undefined && deps.isAlive(owner)) {
    try {
      fs.renameSync(tombstone, slot);
    } catch {
      fs.rmSync(tombstone, { recursive: true, force: true });
    }
    return false;
  }
  fs.rmSync(tombstone, { recursive: true, force: true });
  return true;
}

function acquire(dir: string, name: string, deps: SlotDeps): boolean {
  const slot = path.join(dir, name);
  try {
    fs.mkdirSync(slot);
  } catch (error) {
    if (!isEexist(error)) {
      throw error;
    }
    const owner = readPid(path.join(slot, 'pid'));
    if (owner !== undefined && deps.isAlive(owner)) {
      return false;
    }
    if (!reclaim(dir, name, deps)) {
      return false;
    }
    try {
      fs.mkdirSync(slot);
    } catch (retryError) {
      if (!isEexist(retryError)) {
        throw retryError;
      }
      return false;
    }
  }
  return claimPid(slot, deps.pid);
}

// Takes the first free name. A slot with a live pid is busy; a slot with a dead
// (or missing) pid is reclaimed and taken. Returns the name, or undefined when
// every name is busy.
export function tryAcquire(
  dir: string,
  names: string[],
  deps: Partial<SlotDeps> = {},
): string | undefined {
  const resolved: SlotDeps = {
    pid: deps.pid ?? process.pid,
    isAlive: deps.isAlive ?? defaultIsAlive,
    now: deps.now ?? Date.now,
  };
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) {
    if (acquire(dir, name, resolved)) {
      return name;
    }
  }
  return undefined;
}

export function release(dir: string, name: string): void {
  fs.rmSync(path.join(dir, name), { recursive: true, force: true });
}
