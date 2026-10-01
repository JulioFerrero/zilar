import { access, constants, mkdir, readdir } from 'node:fs/promises';
import { count } from 'drizzle-orm';
import type { ServerDatabase } from './db/client';
import { stickers } from './db/schema';

// Startup helpers shared by `index.ts` (T-0120).

export interface EnsureWritableDirDeps {
  mkdir: (dir: string, options: { recursive: boolean }) => Promise<unknown>;
  access: (dir: string, mode: number) => Promise<void>;
  writeAccess: number;
  onError: (message: string) => void;
  exit: (code: number) => void;
  /**
   * Called with the resolved dir when it did not exist yet and was created
   * (T-0146). The default logs ONE warning line with the resolved path; a
   * relative value resolving to an empty, unexpected directory (e.g. a
   * build step moved the package root) is the "moved base" case.
   */
  onCreated?: ((dir: string) => void) | undefined;
}

function defaultDeps(): EnsureWritableDirDeps {
  return {
    mkdir: (dir, options) => mkdir(dir, options),
    access: (dir, mode) => access(dir, mode),
    writeAccess: constants.W_OK,
    onError: (message) => console.error(message),
    exit: (code) => process.exit(code),
    onCreated: (dir) => console.warn(`STICKER_STORAGE_DIR did not exist; created ${dir}`),
  };
}

/** Creates `dir` when missing and fails fast when it is not writable. */
export async function ensureWritableDir(
  dir: string,
  envName: string,
  deps: EnsureWritableDirDeps = defaultDeps(),
): Promise<void> {
  let created = false;
  // `recursive: true` succeeds whether or not the dir existed, so check
  // existence first: the caller logs one line when the dir was created,
  // which is the signal for "a relative path resolved somewhere new".
  try {
    await deps.access(dir, deps.writeAccess);
  } catch {
    created = true;
  }
  try {
    await deps.mkdir(dir, { recursive: true });
    await deps.access(dir, deps.writeAccess);
  } catch {
    deps.onError(
      `${envName} (${dir}) is not writable: create the directory or fix its permissions`,
    );
    deps.exit(1);
    return;
  }
  // If the dir did not exist yet and was created now, log ONE warning
  // line with the resolved path (T-0146): a relative value resolving to an
  // empty, unexpected directory (e.g. a build step moved the package root)
  // is the "moved base" case, and the resolved path says where the files
  // actually land. Only when the directory holds no stickers while the
  // database has sticker rows is the mismatch certain — the service logs
  // that line (see `warnOnEmptyStorageDir` below); startup only sees the
  // filesystem.
  if (created) {
    deps.onCreated?.(dir);
  }
}

/**
 * Logs ONE warning line with the resolved storage path when the directory
 * holds no sticker files while the database has sticker rows (T-0146): the
 * "a build step moved the base" case, where a relative
 * `STICKER_STORAGE_DIR` resolved against an unexpected package root and the
 * previously uploaded files are silently unreachable. Callers pass a logger
 * (production) or a recorder (tests).
 */
export async function warnOnEmptyStorageDir(input: {
  db: Pick<ServerDatabase, 'select'>;
  storageDir: string;
  warn: (message: string) => void;
}): Promise<void> {
  const [counter] = await input.db.select({ total: count() }).from(stickers);
  if (Number(counter?.total ?? 0) === 0) {
    return;
  }
  let names: string[];
  try {
    names = await readdir(input.storageDir);
  } catch {
    return;
  }
  const hasStickerFile = names.some((name) => /^\S+\.(webp|png)$/.test(name));
  if (!hasStickerFile) {
    input.warn(
      `STICKER_STORAGE_DIR (${input.storageDir}) holds no sticker files but the database has stickers: a relative path may have resolved against an unexpected base`,
    );
  }
}
