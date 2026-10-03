import { access, constants, mkdir, readdir, stat } from 'node:fs/promises';
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

/**
 * Startup warning (T-0156): when `dirs` resolve onto the container layer in
 * production (no mount), uploads and stickers are silently lost the next
 * time the container is replaced. Warns ONCE per directory, with ids and
 * paths only — never contents. `isProduction` gates the whole check, so
 * development and tests stay quiet; `dirDevice`/`rootDevice` are injected
 * so tests never touch the real filesystem (production compares
 * `stat -c %d` of the dir against `/`: same device = container layer).
 */
export async function warnOnContainerLayerStorage(input: {
  dirs: Array<{ envName: string; dir: string }>;
  isProduction: boolean;
  warn: (message: string) => void;
  dirDevice?: ((dir: string) => Promise<number>) | undefined;
  rootDevice?: (() => Promise<number>) | undefined;
}): Promise<void> {
  if (!input.isProduction) {
    return;
  }
  const dirDevice = input.dirDevice ?? deviceOf;
  const rootDevice = input.rootDevice ?? (async () => deviceOf('/'));
  let root: number;
  try {
    root = await rootDevice();
  } catch {
    return;
  }
  const seen = new Set<string>();
  for (const { envName, dir } of input.dirs) {
    if (seen.has(dir)) {
      continue;
    }
    seen.add(dir);
    let device: number;
    try {
      device = await dirDevice(dir);
    } catch {
      continue;
    }
    if (device === root) {
      input.warn(
        `${envName} (${dir}) is on the container layer, not a mounted volume: files are lost when the container is replaced — mount a persistent volume there`,
      );
    }
  }
}

async function deviceOf(dir: string): Promise<number> {
  const info = await stat(dir);
  return info.dev;
}

/**
 * Startup warning (T-0156): `GIF_PROVIDER` set without `GIF_API_KEY` means
 * the GIF feature is half-configured — every route answers 501. Warns ONCE
 * with names only (never values), so a typo surfaces at boot instead of at
 * the first search.
 */
export function warnOnGifConfig(input: {
  provider: string | undefined;
  apiKey: string | undefined;
  warn: (message: string) => void;
}): void {
  if (input.provider !== undefined && input.apiKey === undefined) {
    input.warn(
      'GIF_PROVIDER is set without GIF_API_KEY: GIF search stays unavailable (501) until the key is set',
    );
  }
}
