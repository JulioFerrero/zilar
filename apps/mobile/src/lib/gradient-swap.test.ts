import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Device report 2026-10-04: pressing "Aa" on a voice note crashed the app in
// Android's LinearGradient.nativeCreate. React Native 0.86 crashes when a live
// view swaps one gradient style for another (iconKey -> segment,
// raisedPill -> primaryKey). A gradient swapped for no gradient is fine. The
// cure is a `key` that changes with the look, so Android builds a fresh view.
const GRADIENTS = 'segment|iconKey|primaryKey|raisedPill';
const SWAP = new RegExp(`style=\\{[^}]*\\? *(${GRADIENTS}) *: *(${GRADIENTS})\\b`);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return name.endsWith('.tsx') && !name.includes('.test.') ? [path] : [];
  });
}

describe('gradient style swaps', () => {
  it('every element that swaps one gradient style for another has a changing key', () => {
    const offenders: string[] = [];
    let swaps = 0;
    for (const file of sourceFiles(join(__dirname, '..'))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!SWAP.test(line)) {
          return;
        }
        swaps += 1;
        const before = lines.slice(Math.max(0, index - 6), index + 1).join('\n');
        if (!/key=\{[^}]*\?/.test(before)) {
          offenders.push(`${file}:${index + 1}`);
        }
      });
    }
    expect(swaps).toBeGreaterThanOrEqual(5);
    expect(offenders).toEqual([]);
  });
});
