import { Effect } from 'effect';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { DeskError } from './protocol';

/**
 * Every path resolves inside the workspace root (plan §3.2): `..`, an absolute path
 * outside it and a symlink that leaves it are refused. The root is its real path, so
 * a `realpath` of the deepest existing parent catches a symlink anywhere.
 */
export interface Workspace {
  readonly root: string;
}

type FsFailure = { readonly code?: string };

function realpath(target: string): Effect.Effect<string, FsFailure> {
  return Effect.try({
    try: () => realpathSync(target),
    catch: (error) => error as FsFailure,
  });
}

// `realpath` the deepest existing ancestor, then re-append the missing suffix:
// `realpathSync` alone throws for a path `write` will create, `resolve` alone skips symlinks.
function realpathDeepestEffect(
  target: string,
  suffix: readonly string[],
): Effect.Effect<string, FsFailure> {
  return realpath(target).pipe(
    Effect.map((real) => (suffix.length === 0 ? real : path.join(real, ...[...suffix].reverse()))),
    Effect.catchIf(
      (error) => error.code === 'ENOENT' || error.code === 'ENOTDIR',
      () => {
        const parent = path.dirname(target);
        return parent === target
          ? Effect.succeed(target)
          : realpathDeepestEffect(parent, [...suffix, path.basename(target)]);
      },
    ),
  );
}

export function realpathDeepest(target: string): string {
  return Effect.runSync(realpathDeepestEffect(target, []));
}

export function openWorkspace(input: string): Workspace {
  return { root: realpathDeepest(path.resolve(input)) };
}

function isInside(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate.startsWith(prefix);
}

export function resolveInside(workspace: Workspace, requested: string): string {
  if (requested.includes('\0')) {
    throw new DeskError('path_escape', 'path contains a null byte');
  }
  const lexical = path.resolve(workspace.root, requested);
  if (!isInside(workspace.root, lexical)) {
    throw new DeskError('path_escape', `path escapes the workspace: ${requested}`);
  }
  const real = realpathDeepest(lexical);
  if (!isInside(workspace.root, real)) {
    throw new DeskError(
      'path_escape',
      `path escapes the workspace through a symlink: ${requested}`,
    );
  }
  return real;
}

export function relativeTo(workspace: Workspace, absolute: string): string {
  return path.relative(workspace.root, absolute) || '.';
}
