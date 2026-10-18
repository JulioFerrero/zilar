import type { AutopilotDeps } from '../autopilot.js';
import {
  applyDoctorRecordPatch,
  decideDoctor,
  doctorReportInfo,
  doctorWorktreeFor,
  startDoctorSession,
  type DoctorAction,
} from '../doctor.js';
import { isFreePaused, pauseFreeOnRefusal } from '../free-pause.js';
import { isGoPaused } from '../go-pause.js';
import { FREE_MUSE } from '../models.js';
import { loadPrompt, renderPrompt } from '../prompts.js';
import { summarizeSession } from '../session.js';
import { appendLog, loadState, updateState } from '../state.js';
import { splitModel } from '../task-file.js';
import type { DoctorRecord } from '../types.js';

// The `since` for the very first audit: the first parent of the commit 30
// commits back, so the first audit covers a bounded window; the root commit
// when the history is shorter.
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

// One audit step over main HEAD: gather the doctor inputs (main HEAD and its
// commit time through the runner in repoRoot, the doctor session state, the
// report in the doctor worktree) and apply decideDoctor. The task loop above
// is untouched by a doctor failure.
export async function tickDoctor(
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
      // T-1942: a doctor session on a free listing the gateway refused pauses
      // all free listings, so the fallback below and later starts skip them.
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
