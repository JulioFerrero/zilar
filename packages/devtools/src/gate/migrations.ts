// OPS-6: the migrator skips every migration id at or below the latest applied
// one (effect Migrator.ts:258), so a migration numbered below the tip that
// merges late never runs and its schema change goes missing. This check refuses
// a new `apps/server/drizzle/NNNN_*.sql` unless the numbers continue from the
// highest on the base branch: the first is max + 1, then +2, and so on. Editing
// an existing migration is only a warning: it was already applied and journaled,
// so the edit changes nothing on a database that ran it.

const MIGRATION_FILE = /^apps\/server\/drizzle\/(\d+)_[^/]*\.sql$/;

export interface MigrationDiff {
  /** Added migration files in the diff against the base. */
  added: string[];
  /** Modified migration files in the diff against the base. */
  modified: string[];
}

export interface MigrationCheckReport {
  /** One message per added file whose number does not continue the sequence. */
  failures: string[];
  /** One message per modified migration file. */
  warnings: string[];
}

export function migrationNumber(file: string): number | undefined {
  const match = MIGRATION_FILE.exec(file);
  return match === null ? undefined : Number(match[1]);
}

function fourDigits(number: number): string {
  return String(number).padStart(4, '0');
}

/**
 * The added and modified migration files in `git diff --name-status` output.
 * A rename or copy line carries two paths (`R100\told\tnew`) and lands at a new
 * path, so its destination counts as added; missing that would let a migration
 * introduced by rename slip past the sequence check.
 */
export function parseMigrationDiff(text: string): MigrationDiff {
  const added = new Set<string>();
  const modified = new Set<string>();
  for (const line of text.split('\n')) {
    const [status = '', first = '', second = ''] = line.split('\t');
    if (status === 'A') {
      added.add(first);
    } else if (status === 'M') {
      modified.add(first);
    } else if (status.startsWith('R') || status.startsWith('C')) {
      added.add(second);
    }
  }
  return { added: [...added].sort(), modified: [...modified].sort() };
}

export function checkMigrations(diff: MigrationDiff, baseMax: number): MigrationCheckReport {
  const failures: string[] = [];
  const added = diff.added
    .flatMap((file) => {
      const number = migrationNumber(file);
      return number === undefined ? [] : [{ file, number }];
    })
    .sort((left, right) => left.number - right.number);
  for (const [index, entry] of added.entries()) {
    const expected = baseMax + 1 + index;
    if (entry.number !== expected) {
      failures.push(
        `${entry.file}: expected ${fourDigits(expected)}, found ${fourDigits(entry.number)}`,
      );
    }
  }
  const warnings: string[] = [];
  for (const file of diff.modified) {
    if (migrationNumber(file) !== undefined) {
      warnings.push(
        `${file} is an existing migration; editing it does not run once it is journaled`,
      );
    }
  }
  return { failures, warnings };
}
