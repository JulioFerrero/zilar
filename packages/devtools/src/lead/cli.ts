// The `lead` entry point: `main` and the entry check, invoked as
// `pnpm exec tsx src/lead/cli.ts <command>`.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { alreadyPassedKey, gatePassDir, hasPassRecord, treeKey } from '../gate/pass-record.js';
import { runAutopilot, type AutopilotDeps } from './autopilot.js';
import { OpencodeCliClient } from './client.js';
import { collectSnapshot } from './collect-snapshot.js';
import { doctorWorktreeFor, startDoctorSession } from './doctor.js';
import { runForget } from './forget.js';
import { freshSessionRecord, startFreshWorkerSession } from './fresh-session.js';
import { currentHead, RealGitRunner } from './git.js';
import { findTaskFile, launchTask, parseLaunchArgs } from './launch.js';
import { mergeTask } from './merge.js';
import { loadPrompt, promptsDir, renderPrompt } from './prompts.js';
import { findRepoRoot } from './repo-root.js';
import { startPrereviewSession } from './start-prereview.js';
import { loadState, stateFilePath, updateState } from './state.js';
import { runStatus } from './status.js';
import { switchModel, switchModelInPlace, type SwitchModelDeps } from './switch-model.js';
import { parseFrontMatter, parseTaskFrontMatter, taskFileDir } from './task-file.js';
import { runWatch, runWatchData } from './watch.js';

// `lead spec-check T-XXXX` reads a task's Spec before a worker starts and reports
// claims that are not true of the code: invented features, missing files, absent routes.

interface SpecProblem {
  kind: 'missing-read-first' | 'missing-folder' | 'unknown-route' | 'uncited-web-claim';
  detail: string;
}

interface SpecCheckDeps {
  exists: (relativePath: string) => boolean;
  serverText: () => string;
}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  return args[index + 1];
}

function section(text: string, heading: string): string {
  const match = new RegExp(
    `^### ${heading}\\s*\\n([\\s\\S]*?)(?=^### |^---\\s*$|^## |$(?![\\s\\S]))`,
    'm',
  ).exec(text);
  return match?.[1] ?? '';
}

function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((match) => (match[1] ?? '').trim());
}

function looksLikePath(token: string): boolean {
  return /^[\w@.-]+(\/[\w@.[\]()*-]+)+\/?$/.test(token) && !token.includes(' ');
}

function hasGlob(token: string): boolean {
  return token.includes('*');
}

// `docs/a.md#section` and `docs/a.md:12` name the file.
function bareFile(token: string): string {
  return token.replace(/[#:][^/]*$/, '');
}

function checkSpec(taskText: string, deps: SpecCheckDeps): SpecProblem[] {
  const problems: SpecProblem[] = [];
  const spec = taskText.split(/^## Report/m)[0] ?? taskText;

  for (const token of backticked(section(spec, 'Read first'))) {
    if (!looksLikePath(bareFile(token)) || hasGlob(token)) {
      continue;
    }
    if (!deps.exists(bareFile(token))) {
      problems.push({ kind: 'missing-read-first', detail: token });
    }
  }

  for (const token of backticked(section(spec, 'Allowed files'))) {
    if (!looksLikePath(token)) {
      continue;
    }
    const concrete = token.split('*')[0] ?? token;
    const folder = concrete.endsWith('/') ? concrete.slice(0, -1) : path.posix.dirname(concrete);
    // A new folder is fine (a task may create one); a new folder under a
    // folder that does not exist either is a typo.
    const parent = path.posix.dirname(folder);
    const typo = !deps.exists(folder) && parent !== '.' && !deps.exists(parent);
    if (folder !== '.' && folder !== '' && typo) {
      problems.push({
        kind: 'missing-folder',
        detail: `${token} (neither ${folder} nor its parent exists)`,
      });
    }
  }

  const serverText = deps.serverText();
  const seen = new Set<string>();
  for (const match of spec.matchAll(/`(?:GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[^\s`?]+)/g)) {
    const route = match[1] ?? '';
    if (seen.has(route)) {
      continue;
    }
    seen.add(route);
    // Route params differ in name (":handle" vs "{handle}"): compare the static prefix.
    const prefix = route.replace(/\/[:{][^/]*$/, '').replace(/\/[:{].*$/, '');
    const relative = prefix.replace(/^\/api/, '');
    if (!serverText.includes(relative) && !serverText.includes(prefix)) {
      problems.push({ kind: 'unknown-route', detail: route });
    }
  }

  const claimsWeb = /\b(like|as|same as|matches|mirrors|from) (the )?web\b/i.test(spec);
  if (claimsWeb && !/apps\/web\//.test(spec)) {
    problems.push({
      kind: 'uncited-web-claim',
      detail:
        'the spec says it matches web but names no apps/web/ file; read the web code and cite it',
    });
  }
  return problems;
}

function formatProblems(task: string, problems: SpecProblem[]): string {
  if (problems.length === 0) {
    return `${task}: spec check passed`;
  }
  const lines = problems.map((problem) => `  ${problem.kind}: ${problem.detail}`);
  return [`${task}: ${problems.length} problem(s) in the spec`, ...lines].join('\n');
}

// There is no API to answer a `question` call directly, so the mechanism is interrupt,
// then re-prompt with the lead's text. With `fresh`, that text opens a new session in
// the same worktree and the state points at it.
async function replyToWorker(
  task: string,
  promptFile: string,
  deps: SwitchModelDeps,
  options?: { fresh?: boolean },
): Promise<void> {
  const state = loadState(deps.statePath);
  const record = state.tasks[task];
  if (record === undefined) {
    throw new Error(`unknown task ${task}: no session in the state file`);
  }
  let text: string;
  try {
    text = fs.readFileSync(promptFile, 'utf8');
  } catch {
    throw new Error(`cannot read prompt file ${promptFile}`);
  }
  if (text.trim().length === 0) {
    throw new Error(`prompt file ${promptFile} is empty`);
  }
  if (options?.fresh !== true) {
    await deps.client.interrupt(record.sessionId);
    deps.client.promptDetached(record.sessionId, text);
    return;
  }
  // Every local check runs before the interrupt, so a typo never stops the old worker
  // without a replacement.
  const file = findTaskFile(record.worktree, task);
  const fields = parseFrontMatter(
    fs.readFileSync(path.join(record.worktree, 'work', file), 'utf8'),
  );
  const head = renderPrompt(loadPrompt(deps.promptsDirPath, 'fresh'), {
    TASK: task,
    TASK_FILE: file,
    WORKTREE: record.worktree,
    BRANCH: fields['branch'] ?? '',
  });
  const outcome = await deps.client.tryInterrupt(record.sessionId);
  if (outcome.kind === 'error') {
    throw new Error(
      `refusing to reply fresh to ${task}: cannot interrupt the previous session (${record.sessionId}): ${outcome.message}`,
    );
  }
  const previousSessionId = record.sessionId;
  const { sessionId, model } = await startFreshWorkerSession(
    { client: deps.client, promptsDirPath: deps.promptsDirPath, repoRoot: deps.repoRoot },
    { task, record, title: `${task} reply`, prompt: `${head}\n\n${text}` },
  );
  updateState(deps.statePath, (fresh) => {
    const current = fresh.tasks[task];
    if (current !== undefined && current.sessionId === previousSessionId) {
      fresh.tasks[task] = freshSessionRecord(current, sessionId, model);
    }
  });
}

async function runLaunch(args: string[]): Promise<void> {
  const options = parseLaunchArgs(args);
  const root = findRepoRoot();
  const { sessionId, worktree } = await launchTask(options, {
    repoRoot: root,
    client: new OpencodeCliClient(),
    promptsDirPath: promptsDir(),
    statePath: stateFilePath(),
    runner: new RealGitRunner(),
  });
  console.log(`${options.task} ${sessionId} ${worktree}`);
}

async function runAutopilotCommand(positional: string[], args: string[]): Promise<void> {
  void positional;
  const deps: AutopilotDeps = {
    client: new OpencodeCliClient(),
    runner: new RealGitRunner(),
    statePath: stateFilePath(),
    promptsDirPath: promptsDir(),
    repoRoot: findRepoRoot(),
  };
  await runAutopilot(deps, { once: flag(args, '--once'), dryRun: flag(args, '--dry-run') });
}

async function runDoctor(positional: string[], args: string[]): Promise<void> {
  void positional;
  const root = findRepoRoot();
  const statePath = stateFilePath();
  const runner = new RealGitRunner();
  const head = currentHead(runner, root);
  if (head === undefined) {
    throw new Error(`cannot read HEAD of ${root}`);
  }
  const state = loadState(statePath);
  const since = flagValue(args, '--since') ?? state.doctor?.head;
  if (since === undefined) {
    throw new Error('no previous audit: pass --since <sha>');
  }
  const client = new OpencodeCliClient();
  const { sessionId, model } = await startDoctorSession(
    { client, runner, promptsDirPath: promptsDir(), repoRoot: root },
    { head, since },
  );
  const startedAt = new Date().toISOString();
  updateState(statePath, (fresh) => {
    fresh.doctor = {
      sessionId,
      head,
      since,
      startedAt,
      reportedForHead: undefined,
      stalledReportedForHead: undefined,
      model,
    };
  });
  console.log(`doctor ${sessionId} ${doctorWorktreeFor(root)}`);
}

async function runPrereview(positional: string[]): Promise<void> {
  const task = positional[0];
  if (task === undefined) {
    throw new Error('usage: lead prereview <T-XXXX>');
  }
  const statePath = stateFilePath();
  const state = loadState(statePath);
  const record = state.tasks[task];
  if (record === undefined) {
    throw new Error(`unknown task ${task}: no session in the state file`);
  }
  const client = new OpencodeCliClient();
  const head = currentHead(new RealGitRunner(), record.worktree);
  if (head === undefined) {
    throw new Error(`cannot read HEAD of ${record.worktree}`);
  }
  const { sessionId, model } = await startPrereviewSession(
    { client, promptsDirPath: promptsDir(), worktree: record.worktree, task },
    head,
  );
  const startedAt = new Date().toISOString();
  updateState(statePath, (fresh) => {
    const current = fresh.tasks[task];
    if (current !== undefined) {
      current.prereview = { sessionId, head, startedAt, model };
    }
  });
  console.log(`${task} pre-review ${sessionId} for ${head}`);
}

async function runReply(positional: string[], args: string[]): Promise<void> {
  const task = positional[0];
  const promptFile = positional[1];
  if (task === undefined || promptFile === undefined) {
    throw new Error('usage: lead reply <T-XXXX> <prompt-file> [--fresh]');
  }
  const fresh = flag(args, '--fresh');
  await replyToWorker(
    task,
    promptFile,
    {
      client: new OpencodeCliClient(),
      statePath: stateFilePath(),
      promptsDirPath: promptsDir(),
      // The non-fresh path never uses the repo root, and finding it throws
      // outside a checkout — so only look it up when --fresh needs it.
      repoRoot: fresh ? findRepoRoot() : '',
    },
    { fresh },
  );
  console.log(`${task} replied`);
}

async function runSwitchModel(positional: string[], args: string[]): Promise<void> {
  const task = positional[0];
  const model = positional[1];
  if (task === undefined || model === undefined) {
    throw new Error(
      'usage: lead switch-model <T-XXXX> <provider/model> [--extra-rules <file>] [--in-place] (--in-place keeps the same session and its context; send lead reply after it if the worker is idle)',
    );
  }
  const extraRules = flagValue(args, '--extra-rules');
  const inPlace = flag(args, '--in-place');
  if (inPlace && extraRules !== undefined) {
    throw new Error('--extra-rules needs a new session; drop --in-place');
  }
  const root = findRepoRoot();
  if (inPlace) {
    const { sessionId, model: chosen } = await switchModelInPlace(task, model, {
      repoRoot: root,
      client: new OpencodeCliClient(),
      promptsDirPath: promptsDir(),
      statePath: stateFilePath(),
    });
    console.log(`${task} ${sessionId} ${chosen}`);
    return;
  }
  const { sessionId, model: chosen } = await switchModel(task, model, extraRules, {
    repoRoot: root,
    client: new OpencodeCliClient(),
    promptsDirPath: promptsDir(),
    statePath: stateFilePath(),
  });
  console.log(`${task} ${sessionId} ${chosen}`);
}

function runSpecCheck(positional: string[]): void {
  const task = positional[0];
  if (task === undefined) {
    throw new Error('usage: lead spec-check <T-XXXX>');
  }
  const root = findRepoRoot();
  const dir = taskFileDir(root, task, stateFilePath());
  const file = findTaskFile(dir, task);
  const text = fs.readFileSync(path.join(dir, 'work', file), 'utf8');
  const serverRoot = path.join(root, 'apps', 'server', 'src');
  const problems = checkSpec(text, {
    exists: (relative) => fs.existsSync(path.join(root, relative)),
    serverText: () => {
      const chunks: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.name.endsWith('.ts')) {
            chunks.push(fs.readFileSync(full, 'utf8'));
          }
        }
      };
      walk(serverRoot);
      return chunks.join('\n');
    },
  });
  console.log(formatProblems(task, problems));
  if (problems.length > 0) {
    process.exitCode = 1;
  }
}

async function runSnapshot(positional: string[], page: boolean): Promise<void> {
  const root = findRepoRoot();
  const snapshot = await collectSnapshot({
    client: new OpencodeCliClient(),
    runner: new RealGitRunner(),
    statePath: stateFilePath(),
    root,
    now: Date.now(),
  });
  const json = JSON.stringify(snapshot);
  if (!page) {
    console.log(json);
    return;
  }
  const out = positional[0];
  if (out === undefined) {
    throw new Error('usage: lead dashboard <out.html>');
  }
  const template = fs.readFileSync(
    path.join(root, 'packages', 'devtools', 'dashboard', 'template.html'),
    'utf8',
  );
  // `<` is escaped so task text can never close the script tag.
  fs.writeFileSync(out, template.replace('__SNAPSHOT__', json.replace(/</g, '\\u003c')));
  console.log(`dashboard written to ${out} (${snapshot.active.length} active)`);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// The checks every merge must pass, run in the rebased worktree; the output tail is
// kept so the lead sees the failing step without rerunning. A pass record skips it.
function runGate(worktree: string): { ok: boolean; output: string } {
  const passedKey = alreadyPassedKey(worktree, {
    treeKey,
    hasRecord: (key) => hasPassRecord(gatePassDir, key),
  });
  if (passedKey !== undefined) {
    return {
      ok: true,
      output: `gate: skipped, this tree already passed (${passedKey.slice(0, 12)})`,
    };
  }
  const result = spawnSync('pnpm', ['gate', '--merge'], {
    cwd: worktree,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-45);
  return { ok: result.status === 0, output: output.join('\n') };
}

async function runMerge(positional: string[], args: string[]): Promise<void> {
  const task = positional[0];
  const summary = flagValue(args, '--summary');
  if (task === undefined || summary === undefined || summary.trim().length === 0) {
    throw new Error('usage: lead merge <T-XXXX> --summary "<one line, at most 72 characters>"');
  }
  const root = findRepoRoot();
  const statePath = stateFilePath();
  const worktree = path.join(path.dirname(path.resolve(root)), `zilar-${task}`);
  const dir = taskFileDir(root, task, statePath);
  const file = findTaskFile(dir, task);
  const frontMatter = parseTaskFrontMatter(fs.readFileSync(path.join(dir, 'work', file), 'utf8'));
  const held = args.includes('--hold');
  await mergeTask({
    root,
    task,
    file,
    worktree,
    branch: frontMatter.branch,
    summary,
    today: todayUtc(),
    runner: new RealGitRunner(),
    readText: (entry) => fs.readFileSync(entry, 'utf8'),
    writeText: (entry, text) => fs.writeFileSync(entry, text),
    ...(held ? { push: false } : {}),
    ...(args.includes('--skip-gate') ? {} : { gate: runGate }),
    dropFromState: (entry) => {
      updateState(statePath, (state) => {
        delete state.tasks[entry];
      });
    },
  });
  console.log(held ? `${task} merged (held: run \`lead push\` to deploy)` : `${task} merged`);
}

async function runPush(): Promise<void> {
  const root = findRepoRoot();
  const pushed = new RealGitRunner().run(root, ['push', '-q', 'origin', 'main']);
  if (!pushed.ok) {
    throw new Error('push of main failed');
  }
  console.log('main pushed');
}

const HELP = `lead — zero-token supervision of OpenCode workers

Usage: lead <command> [options]

  launch <T-XXXX> [--extra-rules <file>] [--base <ref>]      create the worktree and worker session (--base branches off an older commit)
  switch-model <T-XXXX> <provider/model> [--extra-rules <file>] [--in-place]
                                                            move a tracked worker onto a new model (quota fallback)
                                                            --in-place keeps the same session and its context; send lead reply after it if the worker is idle
  autopilot [--once] [--dry-run]                            watch sessions, answer permissions, nudge, pre-review
  doctor [--since <sha>]                                    audit main now with a Muse doctor session
  prereview <T-XXXX>                                        start a Muse pre-review manually
  reply <T-XXXX> <prompt-file> [--fresh]                   interrupt the worker and re-prompt it
  merge <T-XXXX> --summary "<one line>" [--skip-gate] [--hold]
                                                            rebase, run the gate, squash onto main, board, push, clean up
                                                            (--hold merges without pushing; run \`lead push\` to deploy)
                                                            ("T-XXXX: summary" is the commit subject, at most 72 characters)
  push                                                      push main to origin (deploys; use after \`lead merge --hold\`)
  spec-check <T-XXXX>                                    check a spec's paths, routes and web claims against the code
  snapshot                                                  JSON of every task in flight, its step and timings
  dashboard <out.html>                                      the snapshot rendered as the dashboard page
  status                                                    compact table of every tracked task
  forget <T-XXXX> [...] | --finished [--dry-run]            drop tracked tasks from the state file
  watch [--no-icons]                                          live terminal view of every running task

State lives outside the repo at ~/.zilar-lead/state.json (or ZILAR_LEAD_STATE).
Escalations print as one LEAD: line each on stdout; everything else goes to lead.log.
The autopilot never merges, pushes, or edits task files or the board.
`;

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const positional = rest.filter((arg) => !arg.startsWith('--'));
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return;
  }
  if (command === 'launch') {
    await runLaunch(rest);
  } else if (command === 'switch-model') {
    await runSwitchModel(positional, rest);
  } else if (command === 'autopilot') {
    await runAutopilotCommand(positional, rest);
  } else if (command === 'doctor') {
    await runDoctor(positional, rest);
  } else if (command === 'prereview') {
    await runPrereview(positional);
  } else if (command === 'reply') {
    await runReply(positional, rest);
  } else if (command === 'snapshot') {
    await runSnapshot(positional, false);
  } else if (command === 'dashboard') {
    await runSnapshot(positional, true);
  } else if (command === 'spec-check') {
    runSpecCheck(positional);
  } else if (command === 'merge') {
    await runMerge(positional, rest);
  } else if (command === 'push') {
    await runPush();
  } else if (command === 'forget') {
    await runForget(positional, rest);
  } else if (command === 'status') {
    await runStatus();
  } else if (command === 'watch') {
    if (rest.includes('--data')) {
      await runWatchData();
    } else {
      await runWatch({ noIcons: rest.includes('--no-icons') });
    }
  } else {
    throw new Error(`unknown command ${JSON.stringify(command)} (try: lead --help)`);
  }
}

const invoked = process.argv[1] !== undefined && process.argv[1].endsWith('cli.ts');
if (invoked) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`lead: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
