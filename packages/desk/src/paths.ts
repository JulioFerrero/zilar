import { Effect } from 'effect';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { DeskError } from './protocol';

/**
 * Every path a tool is given resolves inside the workspace root (plan §3.2).
 * `..`, an absolute path outside the root and a symlink that leaves the root
 * are all refused with `path_escape`. The root is stored as its real path, so a
 * `realpath` of the deepest existing parent of a requested path is enough to
 * catch a symlink anywhere along the way.
 */
export interface Workspace {
  /** The workspace root, resolved through any symlinks. */
  readonly root: string;
}

/** The `realpath` step is I/O, so it is an Effect; the caller runs it sync. */
type FsFailure = { readonly code?: string };

function realpath(target: string): Effect.Effect<string, FsFailure> {
  return Effect.try({
    try: () => realpathSync(target),
    catch: (error) => error as FsFailure,
  });
}

/**
 * `realpath` on the deepest existing ancestor, then re-append the missing
 * suffix. `realpathSync` alone throws for a path `write` is about to create;
 * `path.resolve` alone would not follow a symlink.
 */
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

/**
 * Resolves `requested` (relative to the root, or absolute) and refuses anything
 * that lands outside it, after following symlinks.
 */
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

/** The path relative to the root, for messages; never `..`, so it stays inside. */
export function relativeTo(workspace: Workspace, absolute: string): string {
  return path.relative(workspace.root, absolute) || '.';
}
