// T-0480: the delegation data core (plan `listener-delegation-plan.md` §4.1,
// §4.3, §4.4 and §8). One AI hands another a task inside a group or topic; the
// permission rules come from the two owner flags on `ais` (`canDelegate` to
// hand out, `acceptsDelegation` to receive). The `delegate` and `task_status`
// tools and the gateway wiring are a later task, so nothing here touches the
// gateway: these are pure DB helpers with the caps applied at the boundary.
//
// T-0568: every query runs on the `effect/sql` client registered for this
// database (see `../../effect/sql`). The exported functions stay `async` so
// callers and tests keep their shape.

import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';

// Caps from the plan §4.4: over-long text is cut, never rejected, and extra
// list items are dropped. The empty objective is the one hard rejection.
export const OBJECTIVE_MAX = 1000;
export const CONTEXT_SUMMARY_MAX = 1200;
export const DELEGATION_LIST_MAX = 10;
export const DELEGATION_ITEM_MAX = 300;
export const RETURN_FORMAT_MAX = 200;
export const RESULT_SUMMARY_MAX = 8000;

export type DelegationStatus = 'working' | 'completed' | 'failed' | 'canceled';

export type FinishStatus = 'completed' | 'failed';

export type DelegationCheckReason =
  'same_ai' | 'cannot_delegate' | 'not_accepting' | 'not_in_room' | 'inactive';

export type DelegationCheckResult = { ok: true } | { ok: false; reason: DelegationCheckReason };

export type CreateDelegationFailureReason = DelegationCheckReason | 'empty_objective';

export interface CheckDelegationInput {
  fromAiId: string;
  toAiId: string;
  groupId: string;
  /** Set for a non-General topic; unset to use the group's own AIs. */
  topicId?: string;
}

export interface CreateDelegationInput extends CheckDelegationInput {
  objective: string;
  contextSummary?: string;
  acceptance?: string[];
  constraints?: string[];
  artifacts?: string[];
  budget?: { currency: string; max: number };
  returnFormat?: string;
  replyTo?: string;
}

export interface DelegationRef {
  id: string;
  toAiId: string;
  objective: string;
  status: 'working';
}

export type CreateDelegationResult =
  { ok: true; delegation: DelegationRef } | { ok: false; reason: CreateDelegationFailureReason };

export interface DelegationView {
  id: string;
  fromAiId: string;
  toAiId: string;
  status: DelegationStatus;
  objective: string;
  resultSummary: string | null;
  artifacts: string[];
  updatedAt: Date;
}

export interface FinishDelegationInput {
  id: string;
  aiId: string;
  status: FinishStatus;
  resultSummary?: string;
  artifacts?: string[];
}

// Trim, drop empty items and keep the first ten, each cut to the item cap.
function capList(items: string[] | undefined): string[] {
  if (items === undefined) return [];
  return items
    .map((item) => item.trim().slice(0, DELEGATION_ITEM_MAX))
    .filter((item) => item.length > 0)
    .slice(0, DELEGATION_LIST_MAX);
}

// A nullable text field: absent or blank becomes null, over-long text is cut.
function capOptional(text: string | undefined, max: number): string | null {
  if (text === undefined) return null;
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

interface TopicRow {
  isGeneral: boolean;
  groupId: string;
}

interface AiIdRow {
  aiId: string;
}

// Both AIs must be members of the room. For a non-General topic that is
// `topicAis`, otherwise the group's `groupAis`; a missing topic is a miss, and
// a topic that belongs to another group is a miss too (the group id the caller
// passed and the topic's own group must agree).
async function bothInRoom(db: ServerDatabase, input: CheckDelegationInput): Promise<boolean> {
  const { fromAiId, toAiId, groupId, topicId } = input;
  if (topicId !== undefined) {
    const resolvedTopicId = topicId;
    const [topic] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<TopicRow>`SELECT is_general, group_id FROM topics
          WHERE id = ${resolvedTopicId} LIMIT 1`;
      }),
    );
    if (!topic || topic.groupId !== groupId) return false;
    if (!topic.isGeneral) {
      const rows = await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<AiIdRow>`SELECT ai_id FROM topic_ais
            WHERE topic_id = ${resolvedTopicId} AND ai_id IN ${sql.in([fromAiId, toAiId])}`;
        }),
      );
      return rows.length === 2;
    }
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiIdRow>`SELECT ai_id FROM group_ais
        WHERE group_id = ${groupId} AND ai_id IN ${sql.in([fromAiId, toAiId])}`;
    }),
  );
  return rows.length === 2;
}

interface AiCheckRow {
  id: string;
  canDelegate: boolean;
  acceptsDelegation: boolean;
  status: string;
}

// The plan §4.1 permission: two different AIs, the source may delegate, the
// target accepts, both are active and both are in the room. An unknown id
// reads as `inactive`.
export async function checkDelegation(
  db: ServerDatabase,
  input: CheckDelegationInput,
): Promise<DelegationCheckResult> {
  const { fromAiId, toAiId } = input;
  if (fromAiId === toAiId) return { ok: false, reason: 'same_ai' };

  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiCheckRow>`SELECT id, can_delegate, accepts_delegation, status FROM ais
        WHERE id IN ${sql.in([fromAiId, toAiId])}`;
    }),
  );
  const source = rows.find((row) => row.id === fromAiId);
  const target = rows.find((row) => row.id === toAiId);
  if (!source || !target) return { ok: false, reason: 'inactive' };
  if (!source.canDelegate) return { ok: false, reason: 'cannot_delegate' };
  if (!target.acceptsDelegation) return { ok: false, reason: 'not_accepting' };
  if (source.status !== 'active' || target.status !== 'active') {
    return { ok: false, reason: 'inactive' };
  }
  if (!(await bothInRoom(db, input))) return { ok: false, reason: 'not_in_room' };
  return { ok: true };
}

// Check the permission, cap the inputs and store the row as `working`.
export async function createDelegation(
  db: ServerDatabase,
  input: CreateDelegationInput,
): Promise<CreateDelegationResult> {
  const check = await checkDelegation(db, input);
  if (!check.ok) return check;

  const objective = input.objective.trim().slice(0, OBJECTIVE_MAX);
  if (objective.length === 0) return { ok: false, reason: 'empty_objective' };

  const id = randomUUID();
  const budget =
    input.budget !== undefined && input.budget.max >= 0
      ? { budgetCurrency: input.budget.currency, budgetMax: input.budget.max.toFixed(2) }
      : { budgetCurrency: null, budgetMax: null };
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO ai_delegations (
          id, from_ai_id, to_ai_id, group_id, topic_id, objective, context_summary,
          acceptance, constraints, artifacts, budget_currency, budget_max,
          return_format, reply_to, status
        ) VALUES (
          ${id}, ${input.fromAiId}, ${input.toAiId}, ${input.groupId},
          ${input.topicId ?? null}, ${objective},
          ${capOptional(input.contextSummary, CONTEXT_SUMMARY_MAX)},
          ${JSON.stringify(capList(input.acceptance))}::jsonb,
          ${JSON.stringify(capList(input.constraints))}::jsonb,
          ${JSON.stringify(capList(input.artifacts))}::jsonb,
          ${budget.budgetCurrency}, ${budget.budgetMax},
          ${capOptional(input.returnFormat, RETURN_FORMAT_MAX)}, ${input.replyTo ?? null}, 'working'
        )`;
    }),
  );
  return { ok: true, delegation: { id, toAiId: input.toAiId, objective, status: 'working' } };
}

// `updated_at` is a `timestamptz`; the driver returns it as a `Date`, as the
// other converted services rely on (`pins/service.ts`, `contact-requests`).
interface DelegationRow {
  id: string;
  fromAiId: string;
  toAiId: string;
  status: DelegationStatus;
  objective: string;
  resultSummary: string | null;
  artifacts: string[];
  updatedAt: Date;
}

// Read one delegation for one AI. A third AI sees null, the same as a missing
// id, so nothing leaks across AIs.
export async function getDelegationForAi(
  db: ServerDatabase,
  id: string,
  aiId: string,
): Promise<DelegationView | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<DelegationRow>`SELECT id, from_ai_id, to_ai_id, status, objective,
          result_summary, artifacts, updated_at
        FROM ai_delegations
        WHERE id = ${id} AND (from_ai_id = ${aiId} OR to_ai_id = ${aiId})
        LIMIT 1`;
    }),
  );
  return row ?? null;
}

// Only the target may finish, and only once: the single conditional update
// makes a second call (or a race) return false.
export async function finishDelegation(
  db: ServerDatabase,
  input: FinishDelegationInput,
): Promise<boolean> {
  const resultSummary = capOptional(input.resultSummary, RESULT_SUMMARY_MAX);
  const updatedAt = new Date().toISOString();
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const artifacts =
        input.artifacts === undefined
          ? sql``
          : sql`, artifacts = ${JSON.stringify(capList(input.artifacts))}::jsonb`;
      return yield* sql<{ id: string }>`UPDATE ai_delegations
        SET status = ${input.status}, result_summary = ${resultSummary}, updated_at = ${updatedAt}${artifacts}
        WHERE id = ${input.id} AND to_ai_id = ${input.aiId} AND status = 'working'
        RETURNING id`;
    }),
  );
  return updated.length > 0;
}

// Only the source may cancel, and only while `working`, by the same single
// conditional update.
export async function cancelDelegation(
  db: ServerDatabase,
  input: { id: string; aiId: string },
): Promise<boolean> {
  const updatedAt = new Date().toISOString();
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE ai_delegations
        SET status = 'canceled', updated_at = ${updatedAt}
        WHERE id = ${input.id} AND from_ai_id = ${input.aiId} AND status = 'working'
        RETURNING id`;
    }),
  );
  return updated.length > 0;
}
