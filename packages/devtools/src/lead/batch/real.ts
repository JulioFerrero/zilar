import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { treeKey } from '../../gate/pass-record.js';
import { RealGitRunner } from '../git.js';
import { mergeTask } from '../merge.js';
import { stateFilePath, updateState } from '../state.js';
import type { BatchMergeDeps } from './merge.js';
import { isRecord } from './parsers.js';
import type { BatchDeps, BatchPackage, CommandResult } from './types.js';

function runShell(
  cwd: string,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ status: 1, output: `${Buffer.concat(chunks).toString('utf8')}\n${String(error)}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? 1, output: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

// The flags after `vitest run` in a package's test script (its own timeouts).
export function testArgsOf(script: string): string[] {
  const match = /^\s*vitest run\s*(.*)$/.exec(script);
  return match === null ? [] : (match[1] as string).split(/\s+/).filter((arg) => arg.length > 0);
}

function readPackages(worktree: string): BatchPackage[] {
  const found: BatchPackage[] = [];
  for (const group of ['apps', 'packages']) {
    const groupDir = path.join(worktree, group);
    if (!fs.existsSync(groupDir)) {
      continue;
    }
    for (const name of fs.readdirSync(groupDir)) {
      const manifest = path.join(groupDir, name, 'package.json');
      if (!fs.existsSync(manifest)) {
        continue;
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (!isRecord(parsed) || typeof parsed['name'] !== 'string') {
        continue;
      }
      const scripts = isRecord(parsed['scripts']) ? parsed['scripts'] : {};
      const script = typeof scripts['test'] === 'string' ? scripts['test'] : undefined;
      found.push({
        name: parsed['name'],
        dir: `${group}/${name}`,
        testArgs: script === undefined ? undefined : testArgsOf(script),
      });
    }
  }
  return found;
}

export function realBatchDeps(root: string): BatchDeps {
  return {
    root,
    git: new RealGitRunner(),
    runCommand: runShell,
    readText: (file) => fs.readFileSync(file, 'utf8'),
    writeText: (file, text) => fs.writeFileSync(file, text),
    makeDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    exists: (file) => fs.existsSync(file),
    listDir: (dir) => {
      try {
        return fs.readdirSync(dir);
      } catch {
        return [];
      }
    },
    listPackages: readPackages,
    treeKey,
    now: () => new Date(),
    waveRoot: path.join(os.homedir(), '.zilar-lead', 'wave'),
    print: (line) => console.log(line),
  };
}

export function realBatchMergeDeps(root: string): BatchMergeDeps {
  const base = realBatchDeps(root);
  const statePath = stateFilePath();
  return {
    root,
    git: base.git,
    readText: base.readText,
    exists: base.exists,
    listDir: base.listDir,
    waveRoot: base.waveRoot,
    print: base.print,
    mergeBase: {
      root,
      today: new Date().toISOString().slice(0, 10),
      runner: base.git,
      readText: base.readText,
      writeText: base.writeText,
      dropFromState: (entry) => {
        updateState(statePath, (state) => {
          delete state.tasks[entry];
        });
      },
    },
    merge: mergeTask,
  };
}
