import fs from 'node:fs';
import path from 'node:path';
import { extractCounts, extractVerdict } from './autopilot/task-info.js';
import { type OpenCodeClient } from './client.js';
import { oneLine, type FindingCounts } from './decide.js';
import type { GitRunner } from './git.js';
import { fallbackModel, FREE_MUSE } from './fallback.js';
import { modelLabel } from './models.js';
import { loadPrompt, loadRulesFile, renderPrompt } from './prompts.js';
import type { SessionState } from './session.js';
import { loadState, stateFilePath } from './state.js';
import { reviewSessionModel } from './task-file.js';
import type { DoctorRecord } from './types.js';

// A quiet main HEAD becomes one audit. Merges landing within the window
// collapse into a single session instead of one per commit.
export const DOCTOR_DEBOUNCE_MS = 10 * 60 * 1000;

export interface DoctorDeps {
  client: OpenCodeClient;
  runner: GitRunner;
  promptsDirPath: string;
  repoRoot: string;
}

// The detached worktree the doctor audits main from. It is the only
// worktree this module ever creates, checks out, or cleans.
export function doctorWorktreeFor(repoRoot: string): string {
  return path.join(path.dirname(path.resolve(repoRoot)), 'zilar-doctor');
}

function shortHead(head: string): string {
  return head.slice(0, 7);
}

export function renderDoctorPrompt(
  promptsDirPath: string,
  input: { head: string; since: string; worktree: string },
): string {
  return renderPrompt(loadPrompt(promptsDirPath, 'doctor'), {
    HEAD: input.head,
    SHORT_HEAD: shortHead(input.head),
    SINCE: input.since,
    SHORT_SINCE: shortHead(input.since),
    WORKTREE: input.worktree,
  });
}

// Reads DOCTOR.md back so the autopilot can escalate its counts and verdict.
export function doctorReportInfo(worktree: string): {
  present: boolean;
  verdict: string;
  counts: FindingCounts | undefined;
} {
  let text: string;
  try {
    text = fs.readFileSync(path.join(worktree, 'DOCTOR.md'), 'utf8');
  } catch {
    return { present: false, verdict: '', counts: undefined };
  }
  return { present: true, verdict: extractVerdict(text), counts: extractCounts(text) };
}

function sameDir(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function isWorktreeOfRepo(runner: GitRunner, repoRoot: string, dir: string): boolean {
  const listed = runner.run(repoRoot, ['worktree', 'list', '--porcelain']);
  if (!listed.ok) {
    throw new Error(`git worktree list failed in ${repoRoot}`);
  }
  const worktrees = listed.stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim());
  return worktrees.some((entry) => sameDir(entry, dir));
}

// Prepares the detached worktree at `head`, refusing a path that is not a git
// worktree of this repo; never touches another worktree.
export function ensureDoctorWorktree(deps: DoctorDeps, head: string): string {
  const worktree = doctorWorktreeFor(deps.repoRoot);
  if (!fs.existsSync(worktree)) {
    const added = deps.runner.run(deps.repoRoot, ['worktree', 'add', '--detach', worktree, head]);
    if (!added.ok) {
      throw new Error(`git worktree add failed for ${worktree}`);
    }
    return worktree;
  }
  if (!isWorktreeOfRepo(deps.runner, deps.repoRoot, worktree)) {
    throw new Error(`doctor path is not a worktree of this repo: ${worktree}`);
  }
  const checkedOut = deps.runner.run(deps.repoRoot, ['-C', worktree, 'checkout', '--detach', head]);
  if (!checkedOut.ok) {
    throw new Error(`git checkout --detach failed in ${worktree}`);
  }
  try {
    fs.unlinkSync(path.join(worktree, 'DOCTOR.md'));
  } catch {
    // No stale report: nothing to clean.
  }
  return worktree;
}

export interface DoctorSession {
  sessionId: string;
  model: string;
}

// Starts a Muse doctor session auditing `head`; the caller records the id and model.
export async function startDoctorSession(
  deps: DoctorDeps,
  input: { head: string; since: string },
): Promise<DoctorSession> {
  const worktree = ensureDoctorWorktree(deps, input.head);
  const prompt = renderDoctorPrompt(deps.promptsDirPath, {
    head: input.head,
    since: input.since,
    worktree,
  });
  const state = loadState(stateFilePath());
  const model = reviewSessionModel(state, { sessionId: state.doctor?.sessionId });
  const sessionId = await deps.client.createSession({
    title: `doctor ${shortHead(input.head)}`,
    agent: 'build',
    model,
    directory: worktree,
    permissions: loadRulesFile(path.join(deps.promptsDirPath, 'rules.json')),
  });
  deps.client.promptDetached(sessionId, prompt);
  return { sessionId, model: `${model.providerID}/${model.id}` };
}

export type DoctorSessionState = SessionState | 'unknown' | 'none';

export interface DecideDoctorInput {
  now: number;
  mainHead: string;
  mainHeadCommitMs: number;
  // The state record, or undefined when the doctor never ran.
  doctor: DoctorRecord | undefined;
  // The fallback `since` for the first audit; the tick gathers it, decideDoctor stays pure.
  sinceFallback: string;
  sessionState: DoctorSessionState;
  reportFilePresent: boolean;
  // From the `Counts:` line of DOCTOR.md; undefined when missing.
  counts: FindingCounts | undefined;
  verdict: string;
  quotaError: boolean;
  // True while OpenCode Go is paused.
  goPaused: boolean;
  freePaused?: boolean;
}

export type DoctorAction =
  | { kind: 'start-doctor'; head: string; since: string }
  | { kind: 'escalate'; line: string }
  | { kind: 'record-doctor'; patch: DoctorRecordPatch }
  | { kind: 'fallback-doctor'; model: string };

export interface DoctorRecordPatch {
  sessionId?: string;
  head?: string;
  since?: string;
  startedAt?: string;
  model?: string;
  reportedForHead?: string;
  stalledReportedForHead?: string;
}

export function applyDoctorRecordPatch(
  record: DoctorRecord | undefined,
  patch: DoctorRecordPatch,
  now: string,
): DoctorRecord {
  return {
    sessionId: patch.sessionId ?? record?.sessionId ?? '',
    head: patch.head ?? record?.head ?? '',
    since: patch.since ?? record?.since ?? '',
    startedAt: patch.startedAt ?? record?.startedAt ?? now,
    model: patch.model ?? record?.model,
    reportedForHead: patch.reportedForHead ?? record?.reportedForHead,
    stalledReportedForHead: patch.stalledReportedForHead ?? record?.stalledReportedForHead,
  };
}

// The doctor's brain as a pure function: it never touches the network, filesystem
// or git; the tick gathers the inputs and applies the returned actions.
export function decideDoctor(input: DecideDoctorInput): DoctorAction[] {
  const actions: DoctorAction[] = [];
  const escalate = (line: string): void => {
    actions.push({ kind: 'escalate', line });
  };
  if (input.mainHead === input.doctor?.head) {
    // A quota-hit free doctor moves to the free GLM Flash, then Go Muse, then paid Muse;
    // with nothing left, the idle checks below run the normal STALLED path.
    if (input.quotaError) {
      const fallback = fallbackModel(
        input.doctor.model ?? FREE_MUSE,
        input.goPaused,
        input.freePaused ?? false,
      );
      if (fallback !== undefined) {
        actions.push({ kind: 'fallback-doctor', model: fallback });
        escalate(`LEAD: FALLBACK doctor continues on ${modelLabel(fallback)}`);
        return actions;
      }
    }
    // Same head already audited: report the findings once, then stay quiet.
    if (input.sessionState === 'idle') {
      if (input.reportFilePresent) {
        if (input.doctor.reportedForHead !== input.mainHead) {
          const counts = input.counts;
          const tag =
            counts === undefined
              ? '[no counts line, read it]'
              : `must-fix ${counts.mustFix}, should-fix ${counts.shouldFix}, nit ${counts.nit}`;
          escalate(
            `LEAD: DOCTOR ${tag} since ${shortHead(input.doctor.since)} (${oneLine(input.verdict, 160)})`,
          );
          actions.push({
            kind: 'record-doctor',
            patch: { reportedForHead: input.mainHead },
          });
        }
      } else if (input.doctor.stalledReportedForHead !== input.mainHead) {
        escalate('LEAD: DOCTOR STALLED (idle, no DOCTOR.md)');
        actions.push({
          kind: 'record-doctor',
          patch: { stalledReportedForHead: input.mainHead },
        });
      }
    }
    return actions;
  }
  // A new head: one audit per head, only once the head is quiet, and never
  // while the previous session is still running.
  if (input.sessionState === 'running') {
    return actions;
  }
  if (input.now - input.mainHeadCommitMs < DOCTOR_DEBOUNCE_MS) {
    return actions;
  }
  actions.push({
    kind: 'start-doctor',
    head: input.mainHead,
    since: input.doctor === undefined ? input.sinceFallback : input.doctor.head,
  });
  return actions;
}
