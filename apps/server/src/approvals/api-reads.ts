import type { ServerCore } from '../app/deps';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ApprovalRule, PublicApproval } from '@zilar/api-contract';

import type { AuditRecorder } from '../audit/recorder';
import type { ServerDatabase } from '../db/client';
import type { ApprovalRuleRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { canSeeTopic, type TopicRow } from '../topics/access';
import { isGroupManager } from '../groups/access';
import { toPublicApproval, type AlwaysEligiblePredicate } from './service';
import type { PublicApprovalRule } from './rules';

// The minimum slice of pino the route needs; tests can pass a captor.
export interface ApprovalsRouteLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface ApprovalsApiDependencies extends Pick<ServerCore, 'auth' | 'db' | 'logger'> {
  audit?: AuditRecorder;
  now?: () => number;
  /** Fired after a successful decision; the response returns first and a
   *  throwing hook never changes it. */
  onDecided?: (approvalId: string) => Promise<void> | void;
  /** Absent means nothing is always eligible, so `approve_always` is refused. */
  alwaysEligible?: AlwaysEligiblePredicate;
}

// Supplied by `approvalNames` (one query per table, not one per row).
export type WireApprovalInput = ReturnType<typeof toPublicApproval> & {
  aiName: string;
  groupName: string | null;
};

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

// The full row `canSeeTopic` needs; `null` for a missing id keeps 404s alike.
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

// `id` distinguishes a missing AI from an unauthorized caller (both answer 404).
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

// Both the AI owner and a group admin may revoke, but only for topics they can
// see.
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

// The route owns the action registry and knows the viewer's group role, so it
// fills the always-eligible flag the service cannot know.
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

// One query for the AIs and one for the groups, never one per row; an id that
// no longer exists gets no entry.
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

// A missing AI is `''`; no group (or a deleted group) is `null`.
export function namesForApproval(
  names: ApprovalNames,
  row: { aiId: string; groupId: string | null },
): { aiName: string; groupName: string | null } {
  return {
    aiName: names.aiNames.get(row.aiId) ?? '',
    groupName: row.groupId === null ? null : (names.groupNames.get(row.groupId) ?? null),
  };
}

// Only topics the viewer can see get a name; an invisible one maps to null,
// which a returned row should never hit since visibility is already gated.
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

export function approverNamesForRow(
  names: Map<string, string[]>,
  topicId: string | null,
): string[] {
  return topicId === null ? [] : (names.get(topicId) ?? []);
}

// One query for the whole list response, never one per row.
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
