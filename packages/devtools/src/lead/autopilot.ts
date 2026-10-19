import fs from 'node:fs';
import path from 'node:path';
import { type OpenCodeClient } from './client.js';
import { applyRecordPatch, decide, type Action, type FindingCounts } from './decide.js';
import {
  applyDoctorRecordPatch,
  decideDoctor,
  doctorReportInfo,
  doctorWorktreeFor,
  startDoctorSession,
  type DoctorAction,
} from './doctor.js';
import { isFreePaused, pauseFreeOnRefusal } from './free-pause.js';
import { freshSessionRecord, startFreshWorkerSession } from './fresh-session.js';
import { currentHead, type GitRunner } from './git.js';
import { isGoPaused } from './go-pause.js';
import { findTaskFile, readTaskFrontMatter } from './launch.js';
import { resolveWorkerVariant } from './model-schedule.js';
import { FREE_MUSE } from './models.js';
import type { PermissionRequest } from './policy/types.js';
import { leadProcessIds, sleep } from './processes.js';
import { loadPrompt, renderPrompt, type PromptName } from './prompts.js';
import { parsePermission, summarizeSession, type SessionState } from './session.js';
import { startPrereviewSession } from './start-prereview.js';
import { appendLog, loadState, updateState } from './state.js';
import {
  defaultSweepDeps,
  runSweep,
  sweepFailedLine,
  sweepLine,
  SWEEP_INTERVAL_MS,
  SWEEP_MAX_AGE_MS,
  type SweepDeps,
} from './sweeper.js';
import { extractBlockedText, parseFrontMatter, splitModel } from './task-file.js';
import type { DoctorRecord, StateFile, TaskRecord } from './types.js';

export const POLL_MS = 15_000;
const MESSAGE_LIMIT = 30;

export interface AutopilotDeps {
  client: OpenCodeClient;
  runner: GitRunner;
  statePath: string;
  promptsDirPath: string;
  repoRoot: string;
  // Injected by runAutopilot (real OS by default). Tests that call tickOnce
  // directly leave it unset, so no real process is ever touched.
  sweeper?: SweepDeps;
}

interface TickResult {
  escalations: string[];
  errors: string[];
}

// The first verdict line out of PREREVIEW.md, for the packet-ready escalation.
export function extractVerdict(text: string): string {
  const line = text.split('\n').find((candidate) => /verdict/i.test(candidate));
  return line === undefined ? '(no verdict line)' : line.trim();
}

// The `Counts: ...` line the pre-review prompt asks for; undefined when it is missing.
export function extractCounts(text: string): FindingCounts | undefined {
  const match =
    /counts:[\s*]*must-?fix\s*[=:]?\s*(\d+)\s*[,;]?\s*should-?fix\s*[=:]?\s*(\d+)\s*[,;]?\s*nits?\s*[=:]?\s*(\d+)(?:\s*[,;]?\s*follow-?ups?\s*[=:]?\s*(\d+))?/i.exec(
      text,
    );
  if (match === null) {
    return undefined;
  }
  return {
    mustFix: Number(match[1]),
    shouldFix: Number(match[2]),
    nit: Number(match[3]),
    followUp: match[4] === undefined ? 0 : Number(match[4]),
  };
}

function readTaskInfo(
  worktree: string,
  task: string,
): { file: string; status: string; branch: string; blockedText: string } | null {
  let file: string;
  try {
    file = findTaskFile(worktree, task);
  } catch {
    return null;
  }
  let text: string;
  try {
    text = fs.readFileSync(path.join(worktree, 'work', file), 'utf8');
  } catch {
    return null;
  }
  const fields = parseFrontMatter(text);
  return {
    file,
    status: fields['status'] ?? 'unknown',
    branch: fields['branch'] ?? '',
    blockedText: extractBlockedText(text),
  };
}

function prereviewInfo(worktree: string): {
  present: boolean;
  verdict: string;
  counts: FindingCounts | undefined;
} {
  const file = path.join(worktree, 'PREREVIEW.md');
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { present: false, verdict: '', counts: undefined };
  }
  return { present: true, verdict: extractVerdict(text), counts: extractCounts(text) };
}

function reportError(deps: AutopilotDeps, dryRun: boolean, result: TickResult, line: string): void {
  if (dryRun) {
    console.error(`DRY: ${line}`);
  } else {
    try {
      appendLog(deps.statePath, line);
    } catch {
      // Logging must never break the loop.
    }
  }
  result.errors.push(line);
}

async function applyActions(
  task: string,
  record: TaskRecord,
  actions: Action[],
  deps: AutopilotDeps,
  dryRun: boolean,
  result: TickResult,
): Promise<TaskRecord> {
  let current = record;
  const info = readTaskInfo(record.worktree, task);
  for (const action of actions) {
    if (action.kind === 'record') {
      current = applyRecordPatch(current, action.patch);
      continue;
    }
    if (action.kind === 'escalate') {
      result.escalations.push(action.line);
      if (!dryRun) {
        console.log(action.line);
        appendLog(deps.statePath, action.line);
      }
      continue;
    }
    if (dryRun) {
      continue;
    }
    if (action.kind === 'reply-permission') {
      const target = action.session === 'worker' ? current.sessionId : current.prereview?.sessionId;
      if (target === undefined) {
        continue;
      }
      await deps.client.replyPermission(target, action.requestId, action.decision, action.message);
      appendLog(
        deps.statePath,
        `${task} replied ${action.decision} to ${action.requestId} (${action.session})`,
      );
    } else if (action.kind === 'send-prompt') {
      const prompt = renderPrompt(loadPrompt(deps.promptsDirPath, action.template), {
        TASK: task,
        TASK_FILE: info?.file ?? `${task}.md`,
        WORKTREE: current.worktree,
        BRANCH: info?.branch ?? '',
      });
      if (action.template === 'autofix') {
        // Fix rounds start in a fresh session: the original carries every file read and test
        // log so far, re-sending ~138k tokens per step.
        const round = current.autoFixRounds + 1;
        const { sessionId, model } = await startFreshWorkerSession(
          { client: deps.client, promptsDirPath: deps.promptsDirPath, repoRoot: deps.repoRoot },
          { task, record: current, title: `${task} autofix round ${round}`, prompt },
        );
        current = freshSessionRecord(current, sessionId, model);
        appendLog(deps.statePath, `${task} autofix round ${round} in fresh session ${sessionId}`);
      } else {
        deps.client.promptDetached(current.sessionId, prompt);
        appendLog(deps.statePath, `${task} sent ${action.template} prompt`);
      }
    } else if (action.kind === 'fallback-model') {
      const vars = {
        TASK: task,
        TASK_FILE: info?.file ?? `${task}.md`,
        WORKTREE: current.worktree,
        BRANCH: info?.branch ?? '',
      };
      if (action.session === 'worker') {
        const target = current.sessionId;
        const template: PromptName = 'resume';
        try {
          const { model: frontMatterModel, effort } = readTaskFrontMatter(current.worktree, task);
          const at = new Date();
          const variant = resolveWorkerVariant(frontMatterModel, effort, at, isGoPaused(at));
          await deps.client.switchModel(target, { ...splitModel(action.model), variant });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          appendLog(deps.statePath, `${task} fallback-model failed: ${message}`);
          return current;
        }
        deps.client.promptDetached(
          target,
          renderPrompt(loadPrompt(deps.promptsDirPath, template), vars),
        );
        current = { ...current, model: action.model };
        appendLog(deps.statePath, `${task} switched worker to ${action.model} in place`);
      } else {
        const prereview = current.prereview;
        if (prereview === undefined) {
          continue;
        }
        try {
          await deps.client.switchModel(prereview.sessionId, splitModel(action.model));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          appendLog(deps.statePath, `${task} fallback-model failed: ${message}`);
          return current;
        }
        deps.client.promptDetached(
          prereview.sessionId,
          renderPrompt(loadPrompt(deps.promptsDirPath, 'prereview-resume'), vars),
        );
        current = { ...current, prereview: { ...prereview, model: action.model } };
        appendLog(deps.statePath, `${task} switched prereview to ${action.model} in place`);
      }
    } else if (action.kind === 'start-prereview') {
      const { sessionId, model } = await startPrereviewSession(
        {
          client: deps.client,
          promptsDirPath: deps.promptsDirPath,
          worktree: current.worktree,
          task,
        },
        action.head,
      );
      current = {
        ...current,
        prereview: {
          sessionId,
          head: action.head,
          startedAt: new Date().toISOString(),
          model,
        },
        prereviewStalledEscalated: false,
      };
      appendLog(deps.statePath, `${task} started pre-review ${sessionId} for ${action.head}`);
    }
  }
  return current;
}

// In-memory throttle for the process sweeper: at most one sweep every 5 min.
let lastSweepAt: number | undefined;

// Stops leftover vitest/tsc/tsgo/turbo processes that run in a known worktree for too
// long, or at any age when the task says `blocked`. Never touches `opencode` or the
// lead's own pids.
async function maybeSweep(
  state: StateFile,
  deps: AutopilotDeps,
  dryRun: boolean,
  now: number,
): Promise<void> {
  const sweeper = deps.sweeper;
  if (sweeper === undefined) {
    return;
  }
  if (!dryRun && lastSweepAt !== undefined && now - lastSweepAt < SWEEP_INTERVAL_MS) {
    return;
  }
  if (!dryRun) {
    lastSweepAt = now;
  }
  const worktreeRoots: string[] = [];
  const blockedWorktrees: string[] = [];
  const taskByWorktree = new Map<string, string>();
  for (const [task, record] of Object.entries(state.tasks)) {
    worktreeRoots.push(record.worktree);
    taskByWorktree.set(record.worktree, task);
    if (readTaskInfo(record.worktree, task)?.status === 'blocked') {
      blockedWorktrees.push(record.worktree);
    }
  }
  if (worktreeRoots.length === 0) {
    return;
  }
  const lead = leadProcessIds();
  const outcome = await runSweep(
    {
      worktreeRoots,
      blockedWorktrees,
      maxAgeMs: SWEEP_MAX_AGE_MS,
      protectedPids: [lead.currentPid, lead.parentPid],
      taskByWorktree,
      dryRun,
    },
    sweeper,
  );
  if (dryRun) {
    if (outcome.candidates.length > 0) {
      console.log(`DRY: ${sweepLine(outcome.candidates)}`);
    }
    return;
  }
  if (outcome.stopped.length > 0) {
    const line = sweepLine(outcome.stopped);
    console.log(line);
    appendLog(deps.statePath, line);
  }
  if (outcome.survivors.length > 0) {
    const line = sweepFailedLine(outcome.survivors);
    console.log(line);
    appendLog(deps.statePath, line);
  }
}

// The `since` for the first audit: the first parent of the commit 30 back, so the
// first audit covers a bounded window (the root commit on a shorter history).
function firstAuditSince(deps: AutopilotDeps, mainHead: string): string {
  const base30 = deps.runner.run(deps.repoRoot, ['rev-parse', `${mainHead}~30^`]);
  if (base30.ok && /^[0-9a-f]{40}$/.test(base30.stdout.trim())) {
    return base30.stdout.trim();
  }
  const root = deps.runner.run(deps.repoRoot, ['rev-list', '--max-parents=0', mainHead]);
  const first = root.stdout
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return first ?? mainHead;
}

// One audit step over main HEAD: gather the inputs (HEAD and commit time, doctor
// state, report) and apply decideDoctor; a doctor failure never touches the task loop.
async function tickDoctor(
  deps: AutopilotDeps,
  options: { dryRun: boolean; now: number },
): Promise<void> {
  const state = loadState(deps.statePath);
  const mainHeadResult = deps.runner.run(deps.repoRoot, ['rev-parse', 'HEAD']);
  if (!mainHeadResult.ok) {
    return;
  }
  const mainHead = mainHeadResult.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(mainHead)) {
    return;
  }
  const doctor: DoctorRecord | undefined = state.doctor;
  let mainHeadCommitMs = options.now;
  const commitTime = deps.runner.run(deps.repoRoot, ['show', '-s', '--format=%ct', mainHead]);
  if (commitTime.ok) {
    const seconds = Number(commitTime.stdout.trim());
    if (Number.isFinite(seconds)) {
      mainHeadCommitMs = seconds * 1000;
    }
  }
  let sinceFallback: string;
  if (doctor !== undefined) {
    sinceFallback = doctor.head;
  } else {
    sinceFallback = firstAuditSince(deps, mainHead);
  }
  let sessionState: 'running' | 'idle' | 'unknown' | 'none' = 'none';
  let quotaError = false;
  let freeRefusal: string | undefined;
  if (doctor !== undefined) {
    try {
      const summary = summarizeSession(await deps.client.listMessages(doctor.sessionId, 5));
      sessionState = summary.state;
      quotaError = summary.quotaError;
      freeRefusal = summary.freeRefusal;
      // A doctor session on a free listing the gateway refused pauses all free listings.
      if (!options.dryRun) {
        pauseFreeOnRefusal(new Date(options.now), doctor.model ?? FREE_MUSE, freeRefusal);
      }
    } catch {
      sessionState = 'unknown';
    }
  }
  const worktree = doctorWorktreeFor(deps.repoRoot);
  const report = doctorReportInfo(worktree);
  const actions = decideDoctor({
    now: options.now,
    mainHead,
    mainHeadCommitMs,
    doctor,
    sinceFallback,
    sessionState,
    reportFilePresent: report.present,
    counts: report.counts,
    verdict: report.verdict,
    quotaError,
    goPaused: isGoPaused(new Date(options.now)),
    freePaused: isFreePaused(new Date(options.now)),
  });
  await applyDoctorActions(actions, deps, options.dryRun, doctor);
}

async function applyDoctorActions(
  actions: DoctorAction[],
  deps: AutopilotDeps,
  dryRun: boolean,
  doctor: DoctorRecord | undefined,
): Promise<void> {
  const isoNow = new Date().toISOString();
  for (const action of actions) {
    if (action.kind === 'record-doctor') {
      if (dryRun) {
        continue;
      }
      const patch = action.patch;
      const expectedSession = doctor?.sessionId;
      updateState(deps.statePath, (fresh) => {
        if (expectedSession === undefined || fresh.doctor?.sessionId === expectedSession) {
          fresh.doctor = applyDoctorRecordPatch(fresh.doctor, patch, isoNow);
        }
      });
      continue;
    }
    if (action.kind === 'escalate') {
      if (dryRun) {
        console.log(`DRY: would escalate: ${action.line}`);
      } else {
        console.log(action.line);
        appendLog(deps.statePath, action.line);
      }
      continue;
    }
    if (action.kind === 'fallback-doctor') {
      if (dryRun) {
        console.log(`DRY: would switch the doctor to ${action.model}`);
        continue;
      }
      if (doctor === undefined) {
        continue;
      }
      try {
        await deps.client.switchModel(doctor.sessionId, splitModel(action.model));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLog(deps.statePath, `doctor fallback failed: ${message}`);
        return;
      }
      deps.client.promptDetached(
        doctor.sessionId,
        renderPrompt(loadPrompt(deps.promptsDirPath, 'doctor-resume'), {}),
      );
      const patch = { model: action.model };
      const expectedSession = doctor.sessionId;
      updateState(deps.statePath, (fresh) => {
        if (fresh.doctor?.sessionId === expectedSession) {
          fresh.doctor = applyDoctorRecordPatch(fresh.doctor, patch, isoNow);
        }
      });
      appendLog(deps.statePath, `doctor switched to ${action.model} in place`);
      continue;
    }
    if (dryRun) {
      console.log('DRY: would start the doctor');
      continue;
    }
    const { sessionId, model } = await startDoctorSession(
      {
        client: deps.client,
        runner: deps.runner,
        promptsDirPath: deps.promptsDirPath,
        repoRoot: deps.repoRoot,
      },
      { head: action.head, since: action.since },
    );
    const startedAt = new Date().toISOString();
    updateState(deps.statePath, (fresh) => {
      fresh.doctor = {
        sessionId,
        head: action.head,
        since: action.since,
        startedAt,
        reportedForHead: undefined,
        stalledReportedForHead: undefined,
        model,
      };
    });
    appendLog(deps.statePath, `doctor started ${sessionId} for ${action.head}`);
  }
}

// One poll over every worker session in the state file. Read-only when dryRun is
// set: it classifies and prints, but replies, prompts, starts and saves nothing.
export async function tickOnce(
  deps: AutopilotDeps,
  options: { dryRun: boolean; now?: number },
): Promise<TickResult> {
  const result: TickResult = { escalations: [], errors: [] };
  const now = options.now ?? Date.now();
  const state = loadState(deps.statePath);
  try {
    await maybeSweep(state, deps, options.dryRun, now);
  } catch (error) {
    // The sweep must never break the task loop.
    const line = `sweeper: autopilot error: ${error instanceof Error ? error.message : String(error)}`;
    reportError(deps, options.dryRun, result, line);
  }
  const initialSessions = new Map<string, string>();
  for (const [task, record] of Object.entries(state.tasks)) {
    initialSessions.set(task, record.sessionId);
  }
  const updated = new Map<string, TaskRecord>();
  for (const task of Object.keys(state.tasks).sort()) {
    const record = state.tasks[task];
    if (record === undefined || record.role !== 'worker') {
      continue;
    }
    try {
      const rawPermissions = await deps.client.listPermissions(record.sessionId);
      const permissions = rawPermissions
        .map((entry) => parsePermission(entry))
        .filter((entry) => entry !== null);
      const summary = summarizeSession(
        await deps.client.listMessages(record.sessionId, MESSAGE_LIMIT),
      );
      // A free listing the gateway refused pauses all free listings; a dry run never
      // writes the config file.
      if (!options.dryRun) {
        pauseFreeOnRefusal(new Date(now), record.model, summary.freeRefusal);
      }
      const info = readTaskInfo(record.worktree, task);
      if (info === null) {
        const line = `${task}: task file is gone (worktree removed?); skipping`;
        if (options.dryRun) {
          console.error(`DRY: ${line}`);
        } else {
          appendLog(deps.statePath, line);
        }
        result.errors.push(line);
        continue;
      }
      const head = currentHead(deps.runner, record.worktree);
      const review = prereviewInfo(record.worktree);
      let prereviewSessionState: SessionState | 'none' = 'none';
      let prereviewPermissions: PermissionRequest[] = [];
      let prereviewQuotaError = false;
      let prereviewFailed = false;
      if (record.prereview !== undefined) {
        try {
          const summary = summarizeSession(
            await deps.client.listMessages(record.prereview.sessionId, 5),
          );
          prereviewSessionState = summary.state;
          prereviewQuotaError = summary.quotaError;
          prereviewFailed = summary.state === 'idle' && summary.outcome === 'failed';
          if (!options.dryRun) {
            pauseFreeOnRefusal(
              new Date(now),
              record.prereview.model ?? FREE_MUSE,
              summary.freeRefusal,
            );
          }
        } catch {
          prereviewSessionState = 'unknown';
        }
        try {
          prereviewPermissions = (await deps.client.listPermissions(record.prereview.sessionId))
            .map((entry) => parsePermission(entry))
            .filter((entry) => entry !== null);
        } catch {
          prereviewPermissions = [];
        }
      }
      const actions = decide({
        now,
        task,
        worktree: record.worktree,
        record,
        sessionState: summary.state,
        quotaError: summary.quotaError,
        goPaused: isGoPaused(new Date(now)),
        freePaused: isFreePaused(new Date(now)),
        questionRunning: summary.questionRunning,
        questionText: summary.questionText,
        questionIds: summary.questionIds,
        permissions,
        prereviewPermissions,
        taskStatus: info.status,
        taskFilePresent: true,
        blockedText: info.blockedText,
        head,
        prereviewFilePresent: review.present,
        prereviewVerdict: review.verdict,
        prereviewCounts: review.counts,
        prereviewSessionState,
        prereviewQuotaError,
        prereviewFailed,
      });
      if (options.dryRun) {
        for (const action of actions) {
          if (action.kind === 'escalate') {
            console.log(`DRY: would escalate: ${action.line}`);
          } else if (action.kind === 'reply-permission') {
            console.log(
              `DRY: would reply ${action.decision} to ${action.requestId} (${action.session})${action.message === undefined ? '' : ` (${action.message.slice(0, 80)})`}`,
            );
          } else if (action.kind === 'send-prompt') {
            console.log(`DRY: would send ${action.template} prompt to ${task}`);
          } else if (action.kind === 'fallback-model') {
            console.log(`DRY: would switch ${action.session} of ${task} to ${action.model}`);
          } else if (action.kind === 'start-prereview') {
            console.log(`DRY: would start pre-review for ${task} at ${action.head}`);
          }
        }
        continue;
      }
      updated.set(task, await applyActions(task, record, actions, deps, false, result));
    } catch (error) {
      const line = `${task}: autopilot error: ${error instanceof Error ? error.message : String(error)}`;
      reportError(deps, options.dryRun, result, line);
    }
  }
  if (!options.dryRun) {
    // Re-read the file so writes from other commands during the tick are kept. A record
    // is written back only when the task is still there with the same session: a merged,
    // forgotten or relaunched task keeps what the file says.
    updateState(deps.statePath, (fresh) => {
      for (const [task, record] of updated) {
        const current = fresh.tasks[task];
        if (current !== undefined && current.sessionId === initialSessions.get(task)) {
          fresh.tasks[task] = record;
        }
      }
    });
  }
  try {
    await tickDoctor(deps, { dryRun: options.dryRun, now });
  } catch (error) {
    // The doctor step must never break the task loop: a failure is logged and the results stand.
    const line = `doctor: autopilot error: ${error instanceof Error ? error.message : String(error)}`;
    reportError(deps, options.dryRun, result, line);
  }
  return result;
}

export async function runAutopilot(
  deps: AutopilotDeps,
  options: { once: boolean; dryRun: boolean },
): Promise<TickResult> {
  // The real sweeper is wired here, not in tickOnce, so unit tests that call
  // tickOnce directly never run `ps` or kill anything.
  const active: AutopilotDeps =
    deps.sweeper === undefined ? { ...deps, sweeper: defaultSweepDeps() } : deps;
  const combined: TickResult = { escalations: [], errors: [] };
  for (;;) {
    const tick = await tickOnce(active, { dryRun: options.dryRun });
    combined.escalations.push(...tick.escalations);
    combined.errors.push(...tick.errors);
    if (options.once) {
      return combined;
    }
    await sleep(POLL_MS);
  }
}
