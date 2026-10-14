import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openWorkspace } from './paths';
import { runGit } from './tools/git';
import type { ToolContext } from './tool';

let root: string;

const IDENTITY = {
  GIT_AUTHOR_NAME: 'Desk Test',
  GIT_AUTHOR_EMAIL: 'desk@test.invalid',
  GIT_COMMITTER_NAME: 'Desk Test',
  GIT_COMMITTER_EMAIL: 'desk@test.invalid',
};

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'desk-git-'));
  const clean = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  execFileSync('git', ['init', '-q', root], { env: clean });
  Object.assign(process.env, IDENTITY);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const key of Object.keys(IDENTITY)) {
    delete process.env[key];
  }
});

function context(): ToolContext {
  return {
    workspace: openWorkspace(root),
    maxOutputBytes: 1024 * 1024,
    defaultTimeoutMs: 600_000,
    signal: new AbortController().signal,
  };
}

describe('runGit hardening', () => {
  it('does not run a repository hook on commit', async () => {
    const hook = path.join(root, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\ntouch hook-ran\n');
    chmodSync(hook, 0o755);
    writeFileSync(path.join(root, 'a.txt'), 'hello\n');

    const ctx = context();
    const add = await runGit({ args: ['add', 'a.txt'] }, ctx);
    expect(add.error).toBeUndefined();
    const commit = await runGit({ args: ['commit', '-m', 'fix: hook test'] }, ctx);
    expect(commit.error).toBeUndefined();
    expect(commit.exitCode).toBe(0);
    expect(existsSync(path.join(root, 'hook-ran'))).toBe(false);
  });

  it('refuses -c so a task cannot re-enable a hook', async () => {
    const result = await runGit({ args: ['-c', 'core.hooksPath=/tmp/evil', 'status'] }, context());
    expect(result.error?.code).toBe('tool_failed');
    expect(result.exitCode).not.toBe(0);
  });

  it('does not refuse push -u (set upstream) in the filter', async () => {
    const result = await runGit({ args: ['push', '-u', 'origin', 'main'] }, context());
    expect(result.error).toBeUndefined();
    expect(result.exitCode).not.toBe(0);
  });

  it('refuses a file:// clone because of GIT_ALLOW_PROTOCOL', async () => {
    const result = await runGit({ args: ['clone', `file://${root}`, 'out'] }, context());
    expect(result.error).toBeUndefined();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("transport 'file' not allowed");
  });

  it('refuses a file:// remote added with -t and then fetched', async () => {
    const ctx = context();
    const add = await runGit(
      { args: ['remote', 'add', '-t', 'main', 'origin', `file://${root}`] },
      ctx,
    );
    expect(add.exitCode).toBe(0);
    const fetch = await runGit({ args: ['fetch', 'origin'] }, ctx);
    expect(fetch.error).toBeUndefined();
    expect(fetch.exitCode).not.toBe(0);
    expect(fetch.stderr).toContain("transport 'file' not allowed");
  });

  it('does not block a commit message that contains an https URL', async () => {
    writeFileSync(path.join(root, 'msg-url.txt'), 'hello\n');
    const ctx = context();
    await runGit({ args: ['add', 'msg-url.txt'] }, ctx);
    const commit = await runGit(
      { args: ['commit', '-m', 'see https://example.com/issue-12'] },
      ctx,
    );
    expect(commit.error).toBeUndefined();
    expect(commit.exitCode).toBe(0);
  });
});
