// effect-plain: loop-mounting an ext4 image on a host folder needs root
// (`mount`/`losetup` are process calls, not domain logic); ids are validated so
// no path can escape the configured root.
import { execFile as execFileCallback } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DeskError } from '../protocol';
import type { DeskKey } from '../hands';
import type { AgentConfig } from './config';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The jail's user id; must match `useradd -u 10001` in `packages/desk/Dockerfile`. */
export const JAIL_UID = 10001;

/** Refuses any id that is not a single safe path segment. */
export function assertSafeId(value: string): void {
  if (!SAFE_ID.test(value)) {
    throw new DeskError('path_escape', 'invalid desk id');
  }
}

/** The container/desk name for a key; deterministic, so provisioning is idempotent. */
export function deskName(key: DeskKey): string {
  assertSafeId(key.aiId);
  assertSafeId(key.projectId);
  return `desk-${key.aiId}-${key.projectId}`;
}

/** The folder a desk is mounted from, inside the configured root. */
export function deskDirectory(root: string, key: DeskKey): string {
  assertSafeId(key.aiId);
  assertSafeId(key.projectId);
  return path.join(root, key.aiId, key.projectId);
}

function execFile(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFileCallback(
      command,
      [...args],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function directoryBytes(target: string): Promise<number> {
  const info = await stat(target);
  if (info.isFile()) {
    return info.size;
  }
  let total = 0;
  for (const entry of await readdir(target)) {
    total += await directoryBytes(path.join(target, entry));
  }
  return total;
}

export interface Workspaces {
  /** Creates the image and mounts it, then returns the folder to bind into the jail. */
  ensure(key: DeskKey, diskBytes: number): Promise<string>;
  /** Unmounts the workspace; the image survives. */
  release(key: DeskKey): Promise<void>;
  /** Copies the workspace image to `<root>/snapshots/<aiId>/<projectId>/<label>.img`. */
  snapshot(key: DeskKey, label: string): Promise<number>;
  /** Deletes the image and its folder; used by `stop` with `keepWorkspace: false`. */
  remove(key: DeskKey): Promise<void>;
}

async function ensureImage(image: string, mountDir: string, diskBytes: number): Promise<void> {
  await mkdir(path.dirname(image), { recursive: true });
  await mkdir(mountDir, { recursive: true });
  if (!(await exists(image))) {
    await execFile('truncate', ['-s', String(diskBytes), image]);
    await execFile('mkfs.ext4', ['-q', '-F', '-E', `root_owner=${JAIL_UID}:${JAIL_UID}`, image]);
  }
  if (!(await isMounted(mountDir))) {
    await execFile('mount', ['-o', 'loop,rw', image, mountDir]);
  }
  // The disk's root folder belongs to root when mkfs made it; give it to the
  // jail user. Only the root, not recursively, so old images are fixed too.
  await execFile('chown', [`${JAIL_UID}:${JAIL_UID}`, mountDir]);
}

async function isMounted(mountDir: string): Promise<boolean> {
  try {
    await execFile('mountpoint', ['-q', mountDir]);
    return true;
  } catch {
    return false;
  }
}

/** The disk-image workspace: an ext4 file loop-mounted into a host folder. */
function imageWorkspaces(config: AgentConfig): Workspaces {
  const imageOf = (key: DeskKey): string => `${deskDirectory(config.workspaceRoot, key)}.img`;
  const release = async (key: DeskKey): Promise<void> => {
    const mountDir = deskDirectory(config.workspaceRoot, key);
    if (await isMounted(mountDir)) {
      await execFile('umount', [mountDir]);
    }
  };
  return {
    async ensure(key, diskBytes) {
      const image = imageOf(key);
      const mountDir = deskDirectory(config.workspaceRoot, key);
      await ensureImage(image, mountDir, diskBytes);
      return mountDir;
    },
    release,
    async snapshot(key, label) {
      assertSafeId(label);
      const source = imageOf(key);
      const target = snapshotPath(config.workspaceRoot, key, label);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      return (await stat(target)).size;
    },
    async remove(key) {
      await release(key);
      await rm(imageOf(key), { force: true });
      await rm(deskDirectory(config.workspaceRoot, key), { recursive: true, force: true });
    },
  };
}

export function snapshotPath(root: string, key: DeskKey, label: string): string {
  assertSafeId(label);
  return path.join(root, 'snapshots', key.aiId, key.projectId, `${label}.img`);
}

/**
 * A plain folder workspace for hosts without loop devices (macOS dev). Same
 * layout, no image file, no root: a bind mount of the folder.
 */
function directoryWorkspaces(config: AgentConfig): Workspaces {
  return {
    async ensure(key) {
      const mountDir = deskDirectory(config.workspaceRoot, key);
      await mkdir(mountDir, { recursive: true });
      return mountDir;
    },
    async release() {
      // Nothing is mounted; the folder stays.
    },
    async snapshot(key, label) {
      assertSafeId(label);
      const source = deskDirectory(config.workspaceRoot, key);
      const target = snapshotPath(config.workspaceRoot, key, label).replace(/\.img$/, '');
      await mkdir(path.dirname(target), { recursive: true });
      await cp(source, target, { recursive: true });
      return directoryBytes(target);
    },
    async remove(key) {
      await rm(deskDirectory(config.workspaceRoot, key), { recursive: true, force: true });
    },
  };
}

export function createWorkspaces(config: AgentConfig): Workspaces {
  return config.workspaceMode === 'image' ? imageWorkspaces(config) : directoryWorkspaces(config);
}
