// The Effect ratchet (task R6, docs/audit/effect-100-plan.md §4): a changed
// counted source file fails when it is needs-effect on the branch and was
// absent on the base or was not needs-effect there. A file that is already
// needs-effect on the base passes, because the map tracks it. Pure: the caller
// reads both versions (see ratchet-cli.ts).
import { isCountedSource, sourceFile, type Kind } from './generate.js';

export interface RatchetFile {
  path: string;
  /** The file on the branch, or null when the branch deleted it. */
  branchSource: string | null;
  /** The file on the base, or null when the base does not have it. */
  baseSource: string | null;
}

export interface RatchetViolation {
  path: string;
  signals: string[];
  firstHit: { line: number; text: string } | null;
}

// The class of one file's source, with no open tasks (the ratchet ignores them).
const kindOf = (path: string, source: string): Kind => sourceFile(path, source).kind;

export function ratchetViolations(files: readonly RatchetFile[]): RatchetViolation[] {
  return files.flatMap((file) => {
    if (file.branchSource === null || !isCountedSource(file.path)) return [];
    if (kindOf(file.path, file.branchSource) !== 'needs-effect') return [];
    if (file.baseSource !== null && kindOf(file.path, file.baseSource) === 'needs-effect') {
      return [];
    }
    const branch = sourceFile(file.path, file.branchSource);
    return [{ path: file.path, signals: branch.signals, firstHit: branch.firstHit }];
  });
}
