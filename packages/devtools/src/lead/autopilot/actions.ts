import type { AutopilotDeps, TickResult } from '../autopilot.js';
import { applyRecordPatch, type Action } from '../decide.js';
import { freshSessionRecord, startFreshWorkerSession } from '../fresh-session.js';
import { isGoPaused } from '../go-pause.js';
import { readTaskFrontMatter } from '../launch.js';
import { resolveWorkerVariant } from '../model-schedule.js';
import { leadProcessIds } from '../processes.js';
import { loadPrompt, renderPrompt, type PromptName } from '../prompts.js';
import { startPrereviewSession } from '../start-prereview.js';
import { appendLog } from '../state.js';
import {
  runSweep,
  sweepFailedLine,
  sweepLine,
  SWEEP_INTERVAL_MS,
  SWEEP_MAX_AGE_MS,
} from '../sweeper.js';
import { splitModel } from '../task-file.js';
import type { StateFile, TaskRecord } from '../types.js';
import { readTaskInfo } from './task-info.js';

export async function applyActions(
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
        // Fix rounds start in a fresh session: the original one carries every
        // file read and test log so far, which re-sends ~138k tokens per
        // step. The old session is idle, so it needs no interrupt.
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

// Stops leftover vitest/tsc/tsgo/turbo processes that run in a known worktree
// for too long, or at any age when the task file says `blocked`. Never touches
// `opencode`, the lead's own pids, or anything outside the worktrees. Called
// from tickOnce, but only when a sweeper is wired in, so unit tests that call
// tickOnce directly never shell out.
export async function maybeSweep(
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
