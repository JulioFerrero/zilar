import { access, constants, mkdir } from 'node:fs/promises';

// Startup helpers shared by `index.ts` (T-0120).

export interface EnsureWritableDirDeps {
  mkdir: (dir: string, options: { recursive: boolean }) => Promise<unknown>;
  access: (dir: string, mode: number) => Promise<void>;
  writeAccess: number;
  onError: (message: string) => void;
  exit: (code: number) => void;
}

function defaultDeps(): EnsureWritableDirDeps {
  return {
    mkdir: (dir, options) => mkdir(dir, options),
    access: (dir, mode) => access(dir, mode),
    writeAccess: constants.W_OK,
    onError: (message) => console.error(message),
    exit: (code) => process.exit(code),
  };
}

/** Creates `dir` when missing and fails fast when it is not writable. */
export async function ensureWritableDir(
  dir: string,
  envName: string,
  deps: EnsureWritableDirDeps = defaultDeps(),
): Promise<void> {
  try {
    await deps.mkdir(dir, { recursive: true });
    await deps.access(dir, deps.writeAccess);
  } catch {
    deps.onError(
      `${envName} (${dir}) is not writable: create the directory or fix its permissions`,
    );
    deps.exit(1);
  }
}
