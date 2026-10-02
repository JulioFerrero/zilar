import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');

// Lead-owned paths the rename task explicitly excludes: work files, the
// project plan, the worker rules, and already-applied SQL migrations.
const EXCLUDED_PREFIXES = ['work/', 'docs/PROJECT_PLAN.md', 'AGENTS.md', 'apps/server/drizzle/'];

// The legacy product name, built at runtime so this file itself carries no
// literal occurrence of it (the guard scans its own source too).
const LEGACY_NAME = ['gal', 'ena'].join('');
const SELF_FILE = 'packages/devtools/src/no-legacy-name.test.ts';

function isExcluded(path: string): boolean {
  if (path === SELF_FILE) return true;
  return EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

function isText(buffer: Buffer): boolean {
  return !buffer.includes(0);
}

function listTrackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  }) as Buffer;
  return output
    .toString('utf8')
    .split('\0')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function findLegacyNameHits(): string[] {
  const hits: string[] = [];
  for (const file of listTrackedFiles()) {
    if (isExcluded(file)) continue;
    // File names count too: an old name in a tracked path fails the guard.
    if (file.toLowerCase().includes(LEGACY_NAME)) {
      hits.push(`${file}:1: file name still contains the legacy name`);
    }
    let buffer: Buffer;
    try {
      buffer = readFileSync(join(REPO_ROOT, file));
    } catch {
      continue;
    }
    if (!isText(buffer)) continue;
    const lines = buffer.toString('utf8').split('\n');
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(LEGACY_NAME)) {
        hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
      }
    });
  }
  return hits;
}

describe('no-legacy-name guard', () => {
  it('finds no legacy product name (any casing) in tracked files outside the exception list', () => {
    const hits = findLegacyNameHits();
    expect(hits, `legacy name still present:\n${hits.join('\n')}`).toEqual([]);
  });
});
