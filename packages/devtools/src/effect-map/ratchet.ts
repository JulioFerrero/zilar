// The Effect ratchet (docs/audit/effect-100-plan.md §4): a changed counted source
// fails when it is needs-effect on the branch and absent or not on the base. Pure:
// the caller reads both versions.
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
