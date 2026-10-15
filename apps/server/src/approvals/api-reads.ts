// The approvals API's helpers and types (T-1118 split): its read helpers, the
// wire mappers and the route's dependency/logger interfaces. Moved unchanged
// from `./api`; exported so `./api` can import and re-export them.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ApprovalRule, PublicApproval } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { ApprovalRuleRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { canSeeTopic, type TopicRow } from '../topics/access';
import { isGroupManager } from '../groups/access';
import { toPublicApproval, type AlwaysEligiblePredicate } from './service';
import type { PublicApprovalRule } from './rules';

// The minimum slice of pino the route needs to log a hook failure. The
// server wires its own logger; tests can pass a captor.
export interface ApprovalsRouteLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface ApprovalsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  /** Audit recorder; production wires the server's own recorder, real tests
   *  pass a recorder pointed at the test database. */
  audit?: AuditRecorder;
  now?: () => number;
  /** Logger used to render the error envelope and to record hook failures. */
  logger: Logger;
  /**
   * Optional hook fired after a successful decision. The action gateway
   * (T-0090) uses it to execute any pending action tied to the approval;
   * the response is returned to the user before the hook settles, and a
   * throwing hook never changes the decision response.
   */
  onDecided?: (approvalId: string) => Promise<void> | void;
  /**
   * T-0099: predicate the route uses to decide whether `approve_always`
   * is a real choice for this action. Absent = nothing is always
   * eligible, so `approve_always` is refused with 400
   * `always_not_allowed` and the public approval's `alwaysEligible`
   * flag is `false`.
   */
  alwaysEligible?: AlwaysEligiblePredicate;
}

// The AI and group display names a wire approval carries. Supplied by
// `approvalNames` (one query per table, not one per row) and merged in by
// `decoratePublic`.
export type WireApprovalInput = ReturnType<typeof toPublicApproval> & {
  aiName: string;
  groupName: string | null;
};

// Dates travel as ISO strings (what `JSON.stringify` wrote before the
// contract declared the views), so the handlers map the service rows.
export function toWireApproval(row: WireApprovalInput): PublicApproval {
  return {
    ...row,
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWireRule(rule: PublicApprovalRule): ApprovalRule {
  return { ...rule, createdAt: rule.createdAt.toISOString() };
}

// One topic by id: the full row `canSeeTopic` needs (it reads visibility,
// group and archive state). `null` for a missing id, so callers keep the
// same visibility answers and 404s.
export async function loadTopicRow(db: ServerDatabase, topicId: string): Promise<TopicRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE id = ${topicId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

// Every topic of one group, full rows for the same reason.
export async function loadTopicsForGroup(
  db: ServerDatabase,
  groupId: string,
): Promise<ReadonlyArray<TopicRow>> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}`;
    }),
  );
}

// The AI ownership row: `id` distinguishes a missing AI from an unauthorized
// caller (both answer 404), `owner` is the ownership check.
export interface AiOwnerRow {
  id: string;
  owner: string;
}

export async function loadAiOwnerRow(db: ServerDatabase, aiId: string): Promise<AiOwnerRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiOwnerRow>`SELECT id, owner FROM ais WHERE id = ${aiId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

// One rule by id, full row so `canManageRuleFor` sees its topic/group/AI ids.
export async function loadApprovalRule(
  db: ServerDatabase,
  ruleId: string,
): Promise<ApprovalRuleRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ApprovalRuleRow>`SELECT * FROM approval_rules WHERE id = ${ruleId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

// Looks up the AI ownership directly and adds the group-admin check via
// the rules module. Kept in this file because it composes the two
// checks the route needs in one place. T-0110: both the AI owner and a
// group admin may revoke, but only for topics they can see.
export async function canManageRuleFor(
  db: ServerDatabase,
  rule: ApprovalRuleRow,
  userId: string,
): Promise<boolean> {
  if (rule.topicId !== null) {
    const topic = await loadTopicRow(db, rule.topicId);
    if (!topic || !(await canSeeTopic(db, topic, userId))) {
      return false;
    }
  }
  const aiRow = await loadAiOwnerRow(db, rule.aiId);
  if (aiRow && aiRow.owner === userId) {
    return true;
  }
  if (rule.groupId === null) {
    // Personal rule and the caller is not the AI owner: not allowed.
    return false;
  }
  return isGroupManager(db, rule.groupId, userId);
}

// Re-runs `toPublicApproval` with the always-eligible flag filled in.
// The service returns `alwaysEligible: false` because it does not own
// the registry; the route is the boundary that knows. T-0101: the flag
// is per viewer — a group approval is only always-eligible for a group
// owner/admin (`isManager`), since only they may create a group rule.
// Personal-chat approvals need no group check (`isManager` is `true`).
export function decoratePublic(
  row: ReturnType<typeof toPublicApproval>,
  alwaysEligible: AlwaysEligiblePredicate,
  isManager: boolean,
  names: { aiName: string; groupName: string | null } = { aiName: '', groupName: null },
): PublicApproval {
  return toWireApproval({
    ...row,
    ...names,
    alwaysEligible: isManager && alwaysEligible(row.action),
  });
}

// The AI id → name and group id → title maps for a batch of rows: one query
// for the AIs and one for the groups — never one query per row. A batch with
// no group skips the second query; an id that no longer exists gets no entry,
// so callers fall back to `''` or `null` (deleted AI/group).
export interface ApprovalNames {
  aiNames: Map<string, string>;
  groupNames: Map<string, string>;
}

export async function approvalNames(
  db: ServerDatabase,
  rows: ReadonlyArray<{ aiId: string; groupId: string | null }>,
): Promise<ApprovalNames> {
  const aiIds = [...new Set(rows.map((row) => row.aiId))];
  const groupIds = [
    ...new Set(rows.map((row) => row.groupId).filter((id): id is string => id !== null)),
  ];
  const aiNames = new Map<string, string>();
  if (aiIds.length > 0) {
    const aiRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string; name: string }>`SELECT id, name FROM ais
          WHERE id IN ${sql.in(aiIds)}`;
      }),
    );
    for (const row of aiRows) {
      aiNames.set(row.id, row.name);
    }
  }
  const groupNames = new Map<string, string>();
  if (groupIds.length > 0) {
    const groupRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string; title: string }>`SELECT id, title FROM groups
          WHERE id IN ${sql.in(groupIds)}`;
      }),
    );
    for (const row of groupRows) {
      groupNames.set(row.id, row.title);
    }
  }
  return { aiNames, groupNames };
}

// One row's names from the batch maps: a missing AI is `''`, a row with no
// group (or a deleted group) is `null`.
export function namesForApproval(
  names: ApprovalNames,
  row: { aiId: string; groupId: string | null },
): { aiName: string; groupName: string | null } {
  return {
    aiName: names.aiNames.get(row.aiId) ?? '',
    groupName: row.groupId === null ? null : (names.groupNames.get(row.groupId) ?? null),
  };
}

// The topic names for rows the viewer can see, keyed by topic id. A row
// whose topic the viewer cannot see gets no entry (callers map it to
// `topicName: null`); that cannot happen for a returned approval or rule,
// since visibility is already gated — the null is for the client shape.
export async function visibleTopicNames(
  db: ServerDatabase,
  userId: string,
  rows: Array<{ topicId: string | null }>,
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => row.topicId).filter((id) => id !== null))];
  const names = new Map<string, string>();
  for (const id of ids) {
    const topic = await loadTopicRow(db, id);
    if (topic && (await canSeeTopic(db, topic, userId))) {
      names.set(id, topic.name);
    }
  }
  return names;
}

export async function visibleTopicName(
  db: ServerDatabase,
  userId: string,
  row: { topicId: string | null },
): Promise<string | null> {
  if (row.topicId === null) {
    return null;
  }
  return (await visibleTopicNames(db, userId, [row])).get(row.topicId) ?? null;
}

// The approver names for one row from a batch map (empty when the row has
// no topic or the topic has no approver role).
export function approverNamesForRow(
  names: Map<string, string[]>,
  topicId: string | null,
): string[] {
  return topicId === null ? [] : (names.get(topicId) ?? []);
}

// The group ids where the user is an owner/admin. One query for the
// whole list response — never one query per row.
export async function managedGroupIdsForUser(
  db: ServerDatabase,
  userId: string,
): Promise<Set<string>> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ groupId: string }>`SELECT group_id FROM group_members
        WHERE user_id = ${userId} AND role IN ('owner', 'admin')`;
    }),
  );
  return new Set(rows.map((row) => row.groupId));
}
