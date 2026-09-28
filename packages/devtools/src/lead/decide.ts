import { classifyPermission, type PermissionRequest } from './policy.js';
import type { SessionState } from './session.js';
import type { PrereviewRecord, TaskRecord } from './types.js';

export const QUOTA_RETRY_MS = 10 * 60 * 1000;
export const QUOTA_ESCALATE_MS = 60 * 60 * 1000;
export const NUDGE_LIMIT = 2;

export interface DecideInput {
  now: number;
  task: string;
  worktree: string;
  record: TaskRecord;
  sessionState: SessionState;
  quotaError: boolean;
  questionRunning: boolean;
  questionText: string;
  questionIds: string[];
  permissions: PermissionRequest[];
  taskStatus: string;
  taskFilePresent: boolean;
  blockedText: string;
  head: string | undefined;
  prereviewFilePresent: boolean;
  prereviewVerdict: string;
  prereviewSessionState: SessionState | 'none';
}

export type Action =
  | {
      kind: 'reply-permission';
      requestId: string;
      decision: 'once' | 'reject';
      message?: string | undefined;
    }
  | { kind: 'send-prompt'; template: 'resume' | 'nudge' }
  | { kind: 'start-prereview'; head: string }
  | { kind: 'escalate'; line: string }
  | { kind: 'record'; patch: RecordPatch };

export interface RecordPatch {
  nudgesSent?: number;
  lastQuotaRetryAt?: number;
  lastQuotaEscalatedAt?: number;
  packetReadyForHead?: string;
  addEscalatedPermissionIds?: string[];
  addEscalatedQuestionIds?: string[];
  stalledEscalated?: boolean;
  blockedEscalatedText?: string;
  lastEscalation?: string;
}

function oneLine(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

// The autopilot's brain as a pure function of (session state, messages,
// permissions, task-file status, recorded state). It never touches the
// network, the filesystem, or git: the tick in autopilot.ts gathers the
// inputs and applies the returned actions. It never merges, pushes, or
// edits a task file or the board; there is no action for any of those.
export function decide(input: DecideInput): Action[] {
  const actions: Action[] = [];
  if (!input.taskFilePresent) {
    return actions;
  }
  const escalate = (line: string): void => {
    actions.push({ kind: 'escalate', line });
    actions.push({ kind: 'record', patch: { lastEscalation: line } });
  };

  // 1. Permissions: answer what the policy settles, escalate the rest once.
  for (const request of input.permissions) {
    const result = classifyPermission(request, { worktree: input.worktree, task: input.task });
    if (result.verdict === 'allow') {
      actions.push({ kind: 'reply-permission', requestId: request.id, decision: 'once' });
    } else if (result.verdict === 'reject') {
      actions.push({
        kind: 'reply-permission',
        requestId: request.id,
        decision: 'reject',
        message: result.message,
      });
    } else if (!input.record.escalatedPermissionIds.includes(request.id)) {
      escalate(
        `LEAD: PERMISSION ${input.task} ${request.id} ${request.action} ${oneLine(request.command, 160)}`,
      );
      actions.push({
        kind: 'record',
        patch: { addEscalatedPermissionIds: [request.id] },
      });
    }
  }

  // 2. The question tool: a running call means the worker waits on input.
  // There is no API to answer it directly; the lead replies with
  // `lead reply <task> <file>`, which interrupts and re-prompts.
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

  // 4. Review: start one pre-review per HEAD, then report the packet once.
  if (input.taskStatus === 'review' && input.sessionState === 'idle') {
    if (input.head !== undefined && input.record.prereview?.head !== input.head) {
      actions.push({ kind: 'start-prereview', head: input.head });
      return actions;
    }
    if (
      input.head !== undefined &&
      input.record.prereview !== undefined &&
      input.record.prereview.head === input.head &&
      input.prereviewSessionState === 'idle' &&
      input.prereviewFilePresent &&
      input.record.packetReadyForHead !== input.head
    ) {
      escalate(`LEAD: PACKET READY ${input.task} (${oneLine(input.prereviewVerdict, 160)})`);
      actions.push({ kind: 'record', patch: { packetReadyForHead: input.head } });
    }
    return actions;
  }

  if (input.taskStatus !== 'todo' && input.taskStatus !== 'in-progress') {
    return actions;
  }

  // 5. Quota errors: back off the retry, and escalate at most hourly.
  if (input.quotaError) {
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
    escalatedPermissionIds: [...merged],
    escalatedQuestionIds: [...questions],
    stalledEscalated: patch.stalledEscalated ?? record.stalledEscalated,
    blockedEscalatedText: patch.blockedEscalatedText ?? record.blockedEscalatedText,
    lastEscalation: patch.lastEscalation ?? record.lastEscalation,
  };
}

export type { PrereviewRecord };
