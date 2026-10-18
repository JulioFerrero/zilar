// The migrator skips every id at or below the latest applied one, so a migration
// numbered below the tip that merges late never runs. A new
// `apps/server/drizzle/NNNN_*.sql` must continue from the highest number on the base
// branch; editing an existing one is only a warning.

const MIGRATION_FILE = /^apps\/server\/drizzle\/(\d+)_[^/]*\.sql$/;

export interface MigrationDiff {
  added: string[];
  modified: string[];
}

export interface MigrationCheckReport {
  failures: string[];
  warnings: string[];
}

export function migrationNumber(file: string): number | undefined {
  const match = MIGRATION_FILE.exec(file);
  return match === null ? undefined : Number(match[1]);
}

function fourDigits(number: number): string {
  return String(number).padStart(4, '0');
}

// A rename or copy line carries two paths (`R100\told\tnew`) and lands at a new
// path, so its destination counts as added: a migration introduced by rename must
// still pass the sequence check.
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
