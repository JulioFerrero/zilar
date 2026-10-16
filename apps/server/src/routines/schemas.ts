// T-0984: size split of `routines/service.ts`. The routine limits, service
// error, types and title schema live here; the old path stays the barrel.
import { Exit, Schema } from 'effect';
import type { RoutineRow } from '../db/rows';
import { firstIssueMessage } from '../effect/schema-issues';
import type { RoutineSchedule } from './schedule';

export const MAX_ROUTINES_PER_TOPIC = 10;
export const MAX_ROUTINE_TITLE_CHARS = 80;
export const MAX_ROUTINE_INPUT_BYTES = 2 * 1024;
export const MAX_ROUTINE_PROMPT_CHARS = 2000;

export class RoutineServiceError extends Error {
  readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.name = 'RoutineServiceError';
    this.errorCode = errorCode;
  }
}

export type RoutineStatus = 'active' | 'paused' | 'needs_approval';
export type RoutinePausedReason = 'user' | 'failures' | 'hosts_changed';
export type RoutineLastStatus = 'ok' | 'error' | 'skipped';

export type { RoutineRow };

// The tool columns `createRoutine` checks before inserting a routine; the
// effect/sql row comes back camelCased.
export type RoutineToolRow = {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  name: string;
  currentVersion: number;
  approvedHosts: string[];
  deletedAt: Date | null;
};

export type RoutineToolNameRow = {
  name: string;
};

export type RoutineVersionRow = {
  hosts: string[];
};

export interface CreateRoutineInput {
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  toolId: string;
  title: string;
  schedule: unknown;
  input?: unknown;
  approvedHosts: string[];
  userId: string;
}

export interface CreatePromptRoutineInput {
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  title: string;
  schedule: unknown;
  prompt: string;
  userId: string;
}

export interface PublicRoutine {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  kind: 'tool' | 'prompt';
  toolId: string | null;
  prompt: string | null;
  toolName: string;
  title: string;
  schedule: RoutineSchedule;
  status: RoutineStatus;
  pausedReason: RoutinePausedReason | null;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastStatus: RoutineLastStatus | null;
  approvedHosts: string[];
  /** `personal` means the owner's DM with the AI; `group` a group topic. */
  scope: 'personal' | 'group';
}

export interface PauseRoutineResult {
  routine: RoutineRow;
  paused: boolean;
}

export interface ResumeRoutineResult {
  routine: RoutineRow;
  resumed: boolean;
}

export interface DeleteRoutineResult {
  deleted: boolean;
}

const TITLE_CONTROL_CHARS = String.fromCharCode(
  ...Array.from({ length: 32 }, (_, index) => index),
  127,
);

// Replaces `z.string().min(1).max(80).refine(...)`: one `makeFilter` returns
// each text in the old order (empty, too long, control characters). In Effect
// 4.0.2 `{ message }` on the length checks does not reach the issue
// annotations, but a filter's returned string does (T-0561 pitfall).
export const titleSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value: string) => {
      if (value.length < 1) {
        return 'title must not be empty';
      }
      if (value.length > MAX_ROUTINE_TITLE_CHARS) {
        return `title must be at most ${MAX_ROUTINE_TITLE_CHARS} characters`;
      }
      if (value.split('').some((char) => TITLE_CONTROL_CHARS.includes(char))) {
        return 'title must not contain control characters';
      }
      return undefined;
    }),
  ),
);

// T-1641: the title decode shared by `createRoutine` and
// `createPromptRoutine`. Throws the same `invalid_request` service error the
// inline copy in `support.ts` used to.
export function parseRoutineTitle(title: unknown): string {
  const decoded = Schema.decodeUnknownExit(titleSchema)(title);
  if (!Exit.isSuccess(decoded)) {
    let message: string | undefined;
    for (const reason of decoded.cause.reasons) {
      if (reason._tag === 'Fail') {
        message = firstIssueMessage(reason.error.issue);
        break;
      }
    }
    throw new RoutineServiceError('invalid_request', message ?? 'Invalid title');
  }
  return decoded.value;
}
