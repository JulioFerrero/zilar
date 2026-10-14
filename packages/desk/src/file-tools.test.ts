import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openWorkspace } from './paths';
import { runEdit } from './tools/edit';
import { runRead } from './tools/read';
import type { ToolContext } from './tool';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'desk-files-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function context(maxOutputBytes: number): ToolContext {
  return {
    workspace: openWorkspace(root),
    maxOutputBytes,
    defaultTimeoutMs: 600_000,
    signal: new AbortController().signal,
  };
}

describe('capped file reads', () => {
  it('reads a small file whole', async () => {
    writeFileSync(path.join(root, 'small.txt'), 'alpha\nbeta\n');
    const result = await runRead({ path: 'small.txt' }, context(1024));
    expect(result.error).toBeUndefined();
    expect(result.stdout).toBe('alpha\nbeta\n');
  });

  it('refuses a read of a file larger than the cap', async () => {
    writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(2048));
    const result = await runRead({ path: 'big.txt' }, context(64));
    expect(result.error?.code).toBe('output_too_large');
    expect(result.exitCode).not.toBe(0);
  });

  it('refuses an edit of a file larger than the cap', async () => {
    writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(2048));
    const result = await runEdit(
      { path: 'big.txt', oldString: 'x', newString: 'y', replaceAll: true },
      context(64),
    );
    expect(result.error?.code).toBe('output_too_large');
    expect(result.exitCode).not.toBe(0);
  });
});
