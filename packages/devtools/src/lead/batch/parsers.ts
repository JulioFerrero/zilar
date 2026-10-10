import path from 'node:path';

import { firstLines, MESSAGE_LINES, stripAnsi } from './text.js';
import type { BatchPackage, Failure } from './types.js';

const TS_PAREN = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const TS_COLON = /^(.+?):(\d+):(\d+) - error (TS\d+): (.*)$/;
const TURBO_PREFIX = /^(\S+?):typecheck: ?(.*)$/;

/** Typecheck errors from turbo (or plain tsc) output; paths become repo-relative. */
export function parseTypecheckErrors(output: string, packages: BatchPackage[]): Failure[] {
  const dirByName = new Map(packages.map((pkg) => [pkg.name, pkg.dir]));
  const found = new Map<string, Failure>();
  let current: Failure | undefined;
  let extra = 0;
  for (const raw of stripAnsi(output).split('\n')) {
    const prefixed = TURBO_PREFIX.exec(raw);
    const packageDir = prefixed === null ? undefined : dirByName.get(prefixed[1] as string);
    const text = prefixed === null ? raw : (prefixed[2] as string);
    const match = TS_PAREN.exec(text) ?? TS_COLON.exec(text);
    if (match !== null) {
      const relative = (match[1] as string).trim();
      const file = path.posix.normalize(
        packageDir === undefined ? relative : path.posix.join(packageDir, relative),
      );
      const failure: Failure = {
        kind: 'typecheck',
        file,
        name: `${match[4] as string} at ${file}:${match[2] as string}:${match[3] as string}`,
        message: match[5] as string,
      };
      const key = `${failure.name}|${failure.message}`;
      current = found.get(key) ?? failure;
      found.set(key, current);
      extra = 0;
    } else if (current !== undefined && /^\s+\S/.test(text) && extra < MESSAGE_LINES) {
      current.message += `\n${text.trimEnd()}`;
      extra += 1;
    } else {
      current = undefined;
    }
  }
  return [...found.values()];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function relativeTo(worktree: string, file: string): string {
  const relative = path.isAbsolute(file) ? path.relative(worktree, file) : file;
  return relative.split(path.sep).join('/');
}

// oxlint --format=unix: `path:line:col: message [Error/plugin(rule)]`
const LINT_LINE = /^(.+?):(\d+):(\d+): (.*) \[(Error|Warning)\/([^\]]+)\]$/;

/** Lint errors from `oxlint --format=unix`; warnings are ignored. */
export function parseLintErrors(output: string, worktree: string): Failure[] {
  const failures: Failure[] = [];
  for (const raw of stripAnsi(output).split('\n')) {
    const match = LINT_LINE.exec(raw);
    if (match === null || match[5] !== 'Error') {
      continue;
    }
    failures.push({
      kind: 'lint',
      file: path.posix.normalize(relativeTo(worktree, match[1] as string)),
      name: match[6] as string,
      message: `${match[2] as string}:${match[3] as string} ${match[4] as string}`,
    });
  }
  return failures;
}

// prettier --check: `[warn] <path>` per unformatted file; `[warn] Code style issues ...` is the summary.
const PRETTIER_WARN = /^\[warn\] (.+)$/;
const PRETTIER_SUMMARY = /^Code style issues found/;

/** Unformatted files from `prettier --check`, one failure per file. */
export function parsePrettierFiles(output: string, worktree: string): Failure[] {
  const failures: Failure[] = [];
  for (const raw of stripAnsi(output).split('\n')) {
    const match = PRETTIER_WARN.exec(raw.trim());
    if (match === null || PRETTIER_SUMMARY.test(match[1] as string)) {
      continue;
    }
    const file = path.posix.normalize(relativeTo(worktree, match[1] as string));
    failures.push({
      kind: 'format',
      file,
      name: 'prettier',
      message: `Run \`pnpm exec prettier --write ${file}\`, then commit the result.`,
    });
  }
  return failures;
}

/** Failed tests from a Vitest JSON report. Returns undefined when the text is not one. */
export function parseVitestFailures(text: string, worktree: string): Failure[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['testResults'])) {
    return undefined;
  }
  const failures: Failure[] = [];
  for (const entry of parsed['testResults'] as unknown[]) {
    if (!isRecord(entry) || typeof entry['name'] !== 'string') {
      continue;
    }
    const file = relativeTo(worktree, entry['name']);
    const assertions = Array.isArray(entry['assertionResults']) ? entry['assertionResults'] : [];
    let reported = false;
    for (const assertion of assertions as unknown[]) {
      if (!isRecord(assertion) || assertion['status'] !== 'failed') {
        continue;
      }
      reported = true;
      const messages = Array.isArray(assertion['failureMessages'])
        ? (assertion['failureMessages'] as unknown[]).filter(
            (message): message is string => typeof message === 'string',
          )
        : [];
      const title = assertion['fullName'] ?? assertion['title'];
      failures.push({
        kind: 'test',
        file,
        name: typeof title === 'string' ? title : '(unnamed test)',
        message: firstLines(messages.join('\n'), MESSAGE_LINES),
      });
    }
    if (!reported && entry['status'] === 'failed') {
      const message = typeof entry['message'] === 'string' ? entry['message'] : '';
      failures.push({
        kind: 'test',
        file,
        name: '(the file failed to run)',
        message: firstLines(message, MESSAGE_LINES),
      });
    }
  }
  return failures;
}
