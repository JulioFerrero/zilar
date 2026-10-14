import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openWorkspace, resolveInside, type Workspace } from './paths';
import { DeskError } from './protocol';

let root: string;
let outside: string;

beforeEach(() => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'desk-paths-'));
  root = path.join(base, 'workspace');
  outside = path.join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
});

afterEach(() => {
  rmSync(path.dirname(root), { recursive: true, force: true });
});

function expectEscape(workspace: Workspace, requested: string): void {
  try {
    resolveInside(workspace, requested);
    expect.unreachable(`expected ${requested} to be refused`);
  } catch (error) {
    expect(error).toBeInstanceOf(DeskError);
    expect((error as DeskError).code).toBe('path_escape');
  }
}

describe('resolveInside', () => {
  it('resolves a legitimately nested path inside the root', () => {
    const workspace = openWorkspace(root);
    mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
    writeFileSync(path.join(root, 'a', 'b', 'file.txt'), 'hi');
    expect(resolveInside(workspace, 'a/b/file.txt')).toBe(
      path.join(workspace.root, 'a', 'b', 'file.txt'),
    );
    expect(resolveInside(workspace, '.')).toBe(workspace.root);
  });

  it('refuses ..', () => {
    expectEscape(openWorkspace(root), '..');
    expectEscape(openWorkspace(root), 'a/../../outside');
  });

  it('refuses an absolute path outside the root', () => {
    expectEscape(openWorkspace(root), '/etc/passwd');
    expectEscape(openWorkspace(root), outside);
  });

  it('refuses a symlink that points outside the root', () => {
    symlinkSync(outside, path.join(root, 'link'));
    expectEscape(openWorkspace(root), 'link/file.txt');
  });
});
