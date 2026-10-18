import { access, constants, mkdir, readdir, stat } from 'node:fs/promises';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from './db/client';
import { runSql } from './effect/sql';

export interface EnsureWritableDirDeps {
  mkdir: (dir: string, options: { recursive: boolean }) => Promise<unknown>;
  access: (dir: string, mode: number) => Promise<void>;
  writeAccess: number;
  onError: (message: string) => void;
  exit: (code: number) => void;
  onCreated?: ((dir: string) => void) | undefined;
}

function defaultDeps(envName: string): EnsureWritableDirDeps {
  return {
    mkdir: (dir, options) => mkdir(dir, options),
    access: (dir, mode) => access(dir, mode),
    writeAccess: constants.W_OK,
    onError: (message) => console.error(message),
    exit: (code) => process.exit(code),
    onCreated: (dir) => console.warn(`${envName} did not exist; created ${dir}`),
  };
}

export async function ensureWritableDir(
  dir: string,
  envName: string,
  deps: EnsureWritableDirDeps = defaultDeps(envName),
): Promise<void> {
  let created = false;
  // `recursive: true` succeeds whether or not the dir existed, so check existence
  // first: a newly created dir is the signal that a relative path resolved somewhere new.
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
  // Log ONE warning with the resolved path when the dir was just created: a relative
  // value resolved against an unexpected package root, which is where files actually land.
  if (created) {
    deps.onCreated?.(dir);
  }
}

/**
 * Warns when the directory holds no sticker files while the database has sticker rows:
 * a relative `STICKER_STORAGE_DIR` resolved elsewhere, so uploads are unreachable.
 */
export async function warnOnEmptyStorageDir(input: {
  db: ServerDatabase;
  storageDir: string;
  warn: (message: string) => void;
}): Promise<void> {
  const [counter] = await runSql(
    input.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM stickers`;
    }),
  );
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
 * Warns when an upload dir resolves onto the container layer (no mount) in production:
 * uploads are lost when the container is replaced. Ids and paths only, never contents.
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
 * Warns when `GIF_PROVIDER` is set without `GIF_API_KEY`: the feature is half-configured
 * and every route answers 501. Names only, never values.
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
