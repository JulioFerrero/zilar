// A source file is soft-capped at 400 lines and hard-capped at 800; tests, mocks,
// fixtures and generated files are exempt. A file over the soft limit only warns.
// One over the hard limit fails unless the base was already over and the branch
// did not grow it. Pure: the caller reads the working tree and the base.

export const SIZE_LIMIT = 400;
export const HARD_SIZE_LIMIT = 800;

const CODE_FILE = /\.(ts|tsx|mjs|js)$/;
const TEST_OR_SPEC = /\.(test|spec)\.[^./]+$/;
const GENERATED = /\.gen\.[^./]+$/;
const DECLARATION = /\.d\.ts$/;
// `test-harness.ts` and the dotted `gateway.test-harness.ts` form.
const TEST_HARNESS = /(^|\.)test-harness\./;

const EXEMPT_SEGMENTS: readonly string[] = [
  '/__mocks__/',
  '/fixtures/',
  '/mock/',
  '/drizzle/meta/',
];

const MOCK_BACKEND = 'packages/mock-backend/';

export function isSizeChecked(file: string): boolean {
  if (!file.startsWith('apps/') && !file.startsWith('packages/')) return false;
  if (!CODE_FILE.test(file)) return false;
  if (file.startsWith(MOCK_BACKEND)) return false;
  if (TEST_OR_SPEC.test(file) || GENERATED.test(file) || DECLARATION.test(file)) return false;
  const name = file.slice(file.lastIndexOf('/') + 1);
  if (TEST_HARNESS.test(name)) return false;
  return !EXEMPT_SEGMENTS.some((segment) => file.includes(segment));
}

/** Lines in a source string; a lone trailing newline does not start a new line. */
export function countLines(source: string): number {
  if (source === '') return 0;
  const body = source.endsWith('\n') ? source.slice(0, -1) : source;
  return body.split('\n').length;
}

export interface SizeFile {
  path: string;
  /** Lines in the working tree, or null when the branch deleted the file. */
  lines: number | null;
  /** Lines on the base branch, or null when the base has no such file. */
  baseLines: number | null;
}

function message(file: SizeFile, limit: number): string {
  return `${file.path}: ${file.lines} lines (main ${file.baseLines ?? 0}); limit ${limit}`;
}

// The failure message for one file, or null when it is within the hard limit: at
// most the limit, or already over it on the base and not grown since.
function violation(file: SizeFile): string | null {
  const { lines, baseLines } = file;
  if (lines === null || lines <= HARD_SIZE_LIMIT) return null;
  if (baseLines !== null && baseLines > HARD_SIZE_LIMIT && lines <= baseLines) return null;
  return message(file, HARD_SIZE_LIMIT);
}

export function sizeViolations(files: readonly SizeFile[]): string[] {
  const failures: string[] = [];
  for (const file of files) {
    if (!isSizeChecked(file.path)) continue;
    const failure = violation(file);
    if (failure !== null) failures.push(failure);
  }
  return failures;
}

// The warning message for one file over the soft limit and within the hard one.
export function sizeWarnings(files: readonly SizeFile[]): string[] {
  const warnings: string[] = [];
  for (const file of files) {
    if (!isSizeChecked(file.path)) continue;
    const { lines } = file;
    if (lines === null || lines <= SIZE_LIMIT || lines > HARD_SIZE_LIMIT) continue;
    warnings.push(message(file, SIZE_LIMIT));
  }
  return warnings;
}
