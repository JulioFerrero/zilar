import { classifyPermission } from './policy/classify.js';
import { type PermissionRequest } from './policy/types.js';
import { fallbackModel, FREE_MUSE } from './fallback.js';
import { modelLabel } from './models.js';
import type { SessionState } from './session.js';
import type { PrereviewRecord, TaskRecord } from './types.js';

export const QUOTA_RETRY_MS = 10 * 60 * 1000;
export const QUOTA_ESCALATE_MS = 60 * 60 * 1000;
export const NUDGE_LIMIT = 2;
// Automatic fix rounds per task: send the pre-review's must-fix and should-fix back
// this many times, then hand the packet to the lead.
export const AUTOFIX_LIMIT = 2;

export interface FindingCounts {
  mustFix: number;
  shouldFix: number;
  nit: number;
  followUp: number;
}

export interface DecideInput {
  now: number;
  task: string;
  worktree: string;
  record: TaskRecord;
  sessionState: SessionState;
  quotaError: boolean;
  // True while OpenCode Go is paused; fallbacks then skip every Go listing.
  goPaused: boolean;
  // True while the free listings are paused after a gateway refusal.
  freePaused?: boolean;
  questionRunning: boolean;
  questionText: string;
  questionIds: string[];
  permissions: PermissionRequest[];
  prereviewPermissions: PermissionRequest[];
  taskStatus: string;
  taskFilePresent: boolean;
  blockedText: string;
  head: string | undefined;
  prereviewFilePresent: boolean;
  prereviewVerdict: string;
  // From the `Counts:` line of PREREVIEW.md; undefined when the reviewer skipped it.
  prereviewCounts: FindingCounts | undefined;
  prereviewSessionState: SessionState | 'none';
  prereviewQuotaError: boolean;
  // The pre-review went idle with no PREREVIEW.md: treated like a quota error so it
  // falls back instead of only escalating STALLED.
  prereviewFailed: boolean;
}

export type Action =
  | {
      kind: 'reply-permission';
      session: 'worker' | 'prereview';
      requestId: string;
      decision: 'once' | 'reject';
      message?: string | undefined;
    }
  | { kind: 'send-prompt'; template: 'resume' | 'nudge' | 'autofix' }
  | { kind: 'fallback-model'; session: 'worker' | 'prereview'; model: string }
  | { kind: 'start-prereview'; head: string }
  | { kind: 'escalate'; line: string }
  | { kind: 'record'; patch: RecordPatch };

export interface RecordPatch {
  nudgesSent?: number;
  lastQuotaRetryAt?: number;
  lastQuotaEscalatedAt?: number;
  packetReadyForHead?: string;
  prereviewStalledEscalated?: boolean;
  autoFixRounds?: number;
  addEscalatedPermissionIds?: string[];
  addEscalatedQuestionIds?: string[];
  stalledEscalated?: boolean;
  blockedEscalatedText?: string;
  lastEscalation?: string;
}

// First word on a PACKET READY line: clean means nothing must-fix or should-fix.
function packetTag(counts: FindingCounts | undefined, rounds: number): string {
  if (counts === undefined) {
    return '[no counts line, read it]';
  }
  const done = rounds === 0 ? '' : ` after ${rounds} auto round(s)`;
  const followUp = counts.followUp > 0 ? `, follow-up ${counts.followUp}` : '';
  if (counts.mustFix + counts.shouldFix === 0) {
    return `[CLEAN${done}, nit ${counts.nit}${followUp}]`;
  }
  return `[NEEDS LEAD${done}: must-fix ${counts.mustFix}, should-fix ${counts.shouldFix}${followUp}]`;
}

export function oneLine(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

// The autopilot's brain as a pure function: it never touches the network, filesystem
// or git, and has no action for merging, pushing or editing a task.
export function decide(input: DecideInput): Action[] {
  const actions: Action[] = [];
  const freePaused = input.freePaused ?? false;
  if (!input.taskFilePresent) {
    return actions;
  }
  const escalate = (line: string): void => {
    actions.push({ kind: 'escalate', line });
    actions.push({ kind: 'record', patch: { lastEscalation: line } });
  };
  // The in-place worker fallback (free DeepSeek -> Go DeepSeek -> metered -> Go Muse ->
  // paid Muse) and its escalation.
  const pushWorkerFallback = (from: string, to: string): void => {
    actions.push({ kind: 'fallback-model', session: 'worker', model: to });
    escalate(
      `LEAD: FALLBACK ${input.task} ${modelLabel(from)} failed or rate-limited, worker continues on ${modelLabel(to)}`,
    );
  };

  // Permissions: answer what the policy settles, escalate the rest once; the
  // pre-reviewer goes through the same policy.
  const answerPermissions = (
    requests: PermissionRequest[],
    session: 'worker' | 'prereview',
  ): void => {
    const tag = session === 'worker' ? '' : 'pre-review ';
    for (const request of requests) {
      const result = classifyPermission(request, { worktree: input.worktree, task: input.task });
      if (result.verdict === 'allow') {
        actions.push({
          kind: 'reply-permission',
          session,
          requestId: request.id,
          decision: 'once',
        });
      } else if (result.verdict === 'reject') {
        actions.push({
          kind: 'reply-permission',
          session,
          requestId: request.id,
          decision: 'reject',
          message: result.message,
        });
      } else if (!input.record.escalatedPermissionIds.includes(request.id)) {
        escalate(
          `LEAD: PERMISSION ${input.task} ${tag}${request.id} ${request.action} ${oneLine(request.commands.join(' | '), 160)}`,
        );
        actions.push({
          kind: 'record',
          patch: { addEscalatedPermissionIds: [request.id] },
        });
      }
    }
  };
  answerPermissions(input.permissions, 'worker');
  answerPermissions(input.prereviewPermissions, 'prereview');

  // A running question tool means the worker waits on input: `lead reply` interrupts.
  if (input.questionRunning) {
    const fresh = input.questionIds.filter((id) => !input.record.escalatedQuestionIds.includes(id));
    if (fresh.length > 0) {
      escalate(`LEAD: QUESTION ${input.task} ${oneLine(input.questionText, 200)}`);
      actions.push({ kind: 'record', patch: { addEscalatedQuestionIds: fresh } });
    }
  }

  // 3. Blocked short-circuits everything else: the worker is stopped.
  if (input.taskStatus === 'blocked') {
    if (input.record.blockedEscalatedText !== input.blockedText) {
      const first = input.blockedText.split('\n').find((line) => line.trim().length > 0) ?? '';
      escalate(`LEAD: BLOCKED ${input.task} ${oneLine(first || '(no detail)', 200)}`);
      actions.push({ kind: 'record', patch: { blockedEscalatedText: input.blockedText } });
    }
    return actions;
  }

  // One pre-review per HEAD, reported once; one that idles without PREREVIEW.md falls
  // back, then escalates.
  if (input.taskStatus === 'review' && input.sessionState === 'idle') {
    if (input.quotaError) {
      const workerFallback = fallbackModel(input.record.model, input.goPaused, freePaused);
      if (workerFallback !== undefined) {
        pushWorkerFallback(input.record.model, workerFallback);
        return actions;
      }
    }
    if (input.head !== undefined && input.record.prereview?.head !== input.head) {
      actions.push({ kind: 'start-prereview', head: input.head });
      return actions;
    }
    if (
      input.head !== undefined &&
      input.record.prereview !== undefined &&
      input.record.prereview.head === input.head &&
      (input.prereviewQuotaError || (input.prereviewFailed && !input.prereviewFilePresent))
    ) {
      const fallback = fallbackModel(
        input.record.prereview.model ?? FREE_MUSE,
        input.goPaused,
        freePaused,
      );
      if (fallback !== undefined) {
        actions.push({ kind: 'fallback-model', session: 'prereview', model: fallback });
        escalate(`LEAD: FALLBACK ${input.task} pre-review continues on ${modelLabel(fallback)}`);
        return actions;
      }
    }
    if (
      input.head !== undefined &&
      input.record.prereview !== undefined &&
      input.record.prereview.head === input.head &&
      input.prereviewSessionState === 'idle'
    ) {
      if (input.prereviewFilePresent) {
        if (input.record.packetReadyForHead !== input.head) {
          const counts = input.prereviewCounts;
          const blocking = counts === undefined ? 0 : counts.mustFix + counts.shouldFix;
          if (counts !== undefined && blocking > 0 && input.record.autoFixRounds < AUTOFIX_LIMIT) {
            const round = input.record.autoFixRounds + 1;
            escalate(
              `LEAD: AUTOFIX ${input.task} round ${round} (must-fix ${counts.mustFix}, should-fix ${counts.shouldFix})`,
            );
            actions.push({ kind: 'send-prompt', template: 'autofix' });
            actions.push({
              kind: 'record',
              patch: { autoFixRounds: round, packetReadyForHead: input.head },
            });
          } else {
            escalate(
              `LEAD: PACKET READY ${input.task} ${packetTag(counts, input.record.autoFixRounds)} (${oneLine(input.prereviewVerdict, 160)})`,
            );
            actions.push({ kind: 'record', patch: { packetReadyForHead: input.head } });
          }
        }
      } else if (!input.record.prereviewStalledEscalated) {
        escalate(`LEAD: PRE-REVIEW STALLED ${input.task} (idle, no PREREVIEW.md)`);
        actions.push({ kind: 'record', patch: { prereviewStalledEscalated: true } });
      }
    }
    return actions;
  }

  if (input.taskStatus === 'planned' && input.quotaError) {
    const plannedFallback = fallbackModel(input.record.model, input.goPaused, freePaused);
    if (plannedFallback !== undefined) {
      pushWorkerFallback(input.record.model, plannedFallback);
      return actions;
    }
  }

  if (input.taskStatus !== 'todo' && input.taskStatus !== 'in-progress') {
    return actions;
  }

  // 5. Quota errors: back off the retry, and escalate at most hourly.
  if (input.quotaError) {
    const fallback = fallbackModel(input.record.model, input.goPaused, freePaused);
    if (fallback !== undefined) {
      pushWorkerFallback(input.record.model, fallback);
      return actions;
    }
    const lastRetry = input.record.lastQuotaRetryAt;
    if (lastRetry === undefined || input.now - lastRetry >= QUOTA_RETRY_MS) {
      actions.push({ kind: 'send-prompt', template: 'resume' });
      actions.push({ kind: 'record', patch: { lastQuotaRetryAt: input.now } });
    }
    const lastEscalation = input.record.lastQuotaEscalatedAt;
    if (lastEscalation === undefined || input.now - lastEscalation >= QUOTA_ESCALATE_MS) {
      escalate(`LEAD: QUOTA ${input.task} provider quota (retrying every 10m)`);
      actions.push({ kind: 'record', patch: { lastQuotaEscalatedAt: input.now } });
    }
    return actions;
  }

  // 6. Stalls: idle with nothing decided yet. Two nudges, then the lead.
  if (input.sessionState === 'idle') {
    if (input.record.nudgesSent < NUDGE_LIMIT) {
      actions.push({ kind: 'send-prompt', template: 'nudge' });
      actions.push({ kind: 'record', patch: { nudgesSent: input.record.nudgesSent + 1 } });
    } else if (!input.record.stalledEscalated) {
      escalate(`LEAD: STALLED ${input.task} idle with status ${input.taskStatus} after 2 nudges`);
      actions.push({ kind: 'record', patch: { stalledEscalated: true } });
    }
  }
  return actions;
}

export function applyRecordPatch(record: TaskRecord, patch: RecordPatch): TaskRecord {
  const merged = new Set(record.escalatedPermissionIds);
  for (const id of patch.addEscalatedPermissionIds ?? []) {
    merged.add(id);
  }
  const questions = new Set(record.escalatedQuestionIds);
  for (const id of patch.addEscalatedQuestionIds ?? []) {
    questions.add(id);
  }
  return {
    ...record,
    nudgesSent: patch.nudgesSent ?? record.nudgesSent,
    lastQuotaRetryAt: patch.lastQuotaRetryAt ?? record.lastQuotaRetryAt,
    lastQuotaEscalatedAt: patch.lastQuotaEscalatedAt ?? record.lastQuotaEscalatedAt,
    packetReadyForHead: patch.packetReadyForHead ?? record.packetReadyForHead,
    prereviewStalledEscalated: patch.prereviewStalledEscalated ?? record.prereviewStalledEscalated,
    autoFixRounds: patch.autoFixRounds ?? record.autoFixRounds,
    escalatedPermissionIds: [...merged],
    escalatedQuestionIds: [...questions],
    stalledEscalated: patch.stalledEscalated ?? record.stalledEscalated,
    blockedEscalatedText: patch.blockedEscalatedText ?? record.blockedEscalatedText,
    lastEscalation: patch.lastEscalation ?? record.lastEscalation,
  };
}

export type { PrereviewRecord };
