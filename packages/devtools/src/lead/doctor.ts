import fs from 'node:fs';
import path from 'node:path';
import { extractCounts, extractVerdict } from './autopilot.js';
import { type OpenCodeClient } from './client.js';
import type { FindingCounts } from './decide.js';
import type { GitRunner } from './git.js';
import { fallbackModel, FREE_MUSE } from './fallback.js';
import { loadPrompt, loadRulesFile, renderPrompt } from './prompts.js';
import type { SessionState } from './session.js';
import { reviewModel } from './task-file.js';
import type { DoctorRecord } from './types.js';

// The doctor is always Muse: the strongest reader, like the pre-review. The
// exported default keeps the tests honest; the live call site uses
// reviewModel() so ZILAR_REVIEW_MODEL can move it.
export const DOCTOR_MODEL = { providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' };

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

// Reads back DOCTOR.md so the autopilot can escalate its counts and verdict.
// Reuses the pre-review Counts:/verdict parsers; undefined when the doctor
// skipped the line.
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

// Prepares the detached doctor worktree at `head`, creating it on first use.
// Refuses when the path exists but is not a git worktree of this repo, so a
// stray directory (or another checkout) is never clobbered. Never touches
// any other worktree.
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

// Starts a Muse doctor session auditing `head` in the detached worktree.
// The caller records the returned session id in `state.doctor`.
export async function startDoctorSession(
  deps: DoctorDeps,
  input: { head: string; since: string },
): Promise<string> {
  const worktree = ensureDoctorWorktree(deps, input.head);
  const prompt = renderDoctorPrompt(deps.promptsDirPath, {
    head: input.head,
    since: input.since,
    worktree,
  });
  const sessionId = await deps.client.createSession({
    title: `doctor ${shortHead(input.head)}`,
    agent: 'build',
    model: reviewModel(),
    directory: worktree,
    permissions: loadRulesFile(path.join(deps.promptsDirPath, 'rules.json')),
  });
  deps.client.promptDetached(sessionId, prompt);
  return sessionId;
}

export type DoctorSessionState = SessionState | 'unknown' | 'none';

export interface DecideDoctorInput {
  now: number;
  mainHead: string;
  mainHeadCommitMs: number;
  // The state record, or undefined when the doctor never ran.
  doctor: DoctorRecord | undefined;
  // The fallback `since` for the very first audit (the first parent of the
  // commit 30 commits back, or the root when shorter). The tick gathers it;
  // decideDoctor stays pure.
  sinceFallback: string;
  sessionState: DoctorSessionState;
  reportFilePresent: boolean;
  // From the `Counts:` line of DOCTOR.md; undefined when missing.
  counts: FindingCounts | undefined;
  verdict: string;
  quotaError: boolean;
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

function oneLine(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

// The doctor's brain as a pure function. It never touches the network, the
// filesystem, or git: the tick in autopilot.ts gathers the inputs and
// applies the returned actions.
export function decideDoctor(input: DecideDoctorInput): DoctorAction[] {
  const actions: DoctorAction[] = [];
  const escalate = (line: string): void => {
    actions.push({ kind: 'escalate', line });
  };
  if (input.mainHead === input.doctor?.head) {
    // A quota-hit free doctor moves to the paid Muse in place, like workers
    // and pre-reviews. Once there is nothing to fall back to, the idle
    // checks below run the normal STALLED path.
    if (input.quotaError) {
      const fallback = fallbackModel(input.doctor.model ?? FREE_MUSE);
      if (fallback !== undefined) {
        actions.push({ kind: 'fallback-doctor', model: fallback });
        escalate('LEAD: FALLBACK doctor continues on paid Muse');
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
