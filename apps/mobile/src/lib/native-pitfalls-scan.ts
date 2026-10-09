// effect-plain: dev-time scan tool that walks source files with node:fs; never runs in the app
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function walk(dir: string, matches: (name: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path, matches, out);
      continue;
    }
    if (matches(name)) {
      out.push(path);
    }
  }
  return out;
}

const CRYPTO_KEY = 'crypto';
const SUBTLE_KEY = 'subtle';
const CRYPTO_SUBTLE = `${CRYPTO_KEY}.${SUBTLE_KEY}`;
const SUBTLE_CRYPTO = `Subtle${'Crypto'}`;

export type KotlinOffender = { file: string; line: number; text: string };

export function findKotlinCoroutinePromiseOffenders(lines: string[]): KotlinOffender[] {
  const offenders: KotlinOffender[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isCommentLine(trimmed)) continue;
    if (!line.includes('Coroutine')) continue;
    const windowEnd = Math.min(lines.length, index + 7);
    let promiseSeen = false;
    let arrowSeen = false;
    for (let offset = 0; offset < windowEnd - index; offset += 1) {
      const entry = lines[index + offset];
      if (entry.includes('Promise')) {
        promiseSeen = true;
        break;
      }
      if (entry.includes('->')) {
        arrowSeen = true;
        break;
      }
    }
    if (promiseSeen && !arrowSeen) {
      offenders.push({ file: 'sample', line: index + 1, text: line });
    }
  }
  return offenders;
}

export type TsOffender = { file: string; line: number; text: string };

export function findHermesCryptoSubtleOffenders(lines: string[]): TsOffender[] {
  const offenders: TsOffender[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (line.includes(CRYPTO_SUBTLE) || line.includes(SUBTLE_CRYPTO)) {
      offenders.push({ file: 'sample', line: index + 1, text: line });
    }
  }
  return offenders;
}

export function kotlinFiles(root: string): string[] {
  return walk(root, (name) => name.endsWith('.kt'));
}

export function hermesSourceFiles(roots: string[]): string[] {
  return roots.flatMap((root) =>
    walk(root, (name) => {
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return false;
      if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) return false;
      return true;
    }),
  );
}
