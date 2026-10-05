import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findHermesCryptoSubtleOffenders,
  findKotlinCoroutinePromiseOffenders,
  hermesSourceFiles,
  kotlinFiles,
} from './native-pitfalls-scan';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const MODULES_DIR = join(REPO_ROOT, 'apps', 'mobile', 'modules');
const MOBILE_SRC = join(REPO_ROOT, 'apps', 'mobile', 'src');

function moduleSrcRoots(modulesDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(modulesDir)) {
    const candidate = join(modulesDir, name, 'src');
    try {
      if (statSync(candidate).isDirectory()) {
        out.push(candidate);
      }
    } catch {
      continue;
    }
  }
  return out;
}

function fileHasAsyncFunctionWithPromise(text: string): boolean {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes('AsyncFunction')) continue;
    const window = lines.slice(index, Math.min(lines.length, index + 6));
    if (window.some((entry) => /promise\s*:\s*Promise\b/.test(entry))) {
      return true;
    }
  }
  return false;
}

describe('native pitfalls: Kotlin Coroutine + Promise', () => {
  it('no .kt file combines a Coroutine with a Promise parameter on the same statement', () => {
    const offenders: string[] = [];
    let asyncWithPromise = 0;
    const files = kotlinFiles(MODULES_DIR);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      const hits = findKotlinCoroutinePromiseOffenders(lines);
      for (const hit of hits) {
        offenders.push(`${file}:${hit.line}`);
      }
      if (fileHasAsyncFunctionWithPromise(text)) {
        asyncWithPromise += 1;
      }
    }

    expect(asyncWithPromise).toBeGreaterThanOrEqual(1);
    expect(offenders).toEqual([]);
  });
});

describe('native pitfalls: Hermes crypto.subtle', () => {
  it('no .ts/.tsx file (excluding tests) uses crypto.subtle or SubtleCrypto', () => {
    const offenders: string[] = [];
    const files = hermesSourceFiles([MOBILE_SRC, ...moduleSrcRoots(MODULES_DIR)]);
    expect(files.length).toBeGreaterThan(50);

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      const hits = findHermesCryptoSubtleOffenders(lines);
      for (const hit of hits) {
        offenders.push(`${file}:${hit.line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('native pitfalls: self-test of the line scanners', () => {
  it('Kotlin scanner flags a Coroutine+Promise snippet and accepts a plain AsyncFunction', () => {
    const bad = [
      '    AsyncFunction("loadModel") Coroutine { path: String, promise: Promise ->',
      '      promise.resolve("ok")',
      '    }',
    ];
    const badHits = findKotlinCoroutinePromiseOffenders(bad);
    expect(badHits.length).toBe(1);
    expect(badHits[0]?.line).toBe(1);

    const good = [
      '    AsyncFunction("sha256File") { path: String ->',
      '      sha256Hex(path)',
      '    }',
      '    AsyncFunction("loadModel") { path: String, promise: Promise ->',
      '      promise.resolve("ok")',
      '    }',
    ];
    expect(findKotlinCoroutinePromiseOffenders(good)).toEqual([]);
  });

  it('Hermes scanner flags a crypto.subtle.digest line and accepts a commented one', () => {
    const bad = ['const digest = await crypto.subtle.digest("SHA-256", buffer);'];
    const badHits = findHermesCryptoSubtleOffenders(bad);
    expect(badHits.length).toBe(1);
    expect(badHits[0]?.line).toBe(1);

    const good = [
      '// no crypto.subtle in this file, but uses crypto.subtle.digest at runtime?',
      ' * Hermes has no SubtleCrypto either',
      'const x = 1;',
    ];
    expect(findHermesCryptoSubtleOffenders(good)).toEqual([]);
  });
});
