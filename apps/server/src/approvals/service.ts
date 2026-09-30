import { randomUUID, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { ARGS_HASH_PATTERN } from '@galena/protocol';
import type { ServerDatabase } from '../db/client';
import {
  ais,
  approvals,
  groupAis,
  groupMemberRoles,
  groupMembers,
  groupRoles,
  topics,
  user,
} from '../db/schema';
import { canSeeTopic } from '../topics/access';
import { createRule, isGroupAdmin } from './rules';

// `approved_always` is treated exactly like `approved_once` for the
// single-use path; T-0099 adds a separate standing-rule flow that the
// decision route triggers when the adapter is always-eligible and the
// decider chose `approve_always`.
export type ApprovalStatus =
  'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed';

export type ApprovalDecision = 'approve_once' | 'approve_always' | 'deny';

export const MAX_PENDING_APPROVALS_PER_AI = 50;
export const MAX_APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000;

const actionSchema = z.string().min(1).max(100);
const summarySchema = z.string().min(1).max(500);
const detailsSchema = z.string().max(20000).optional();
const argsHashSchema = z.string().regex(ARGS_HASH_PATTERN);
const noteSchema = z.string().max(500).optional();
const requestedBySchema = z.string().min(1).max(3071);
const groupIdSchema = z.string().min(1).max(128).optional();
const topicIdSchema = z.string().min(1).max(128).optional();
const aiIdSchema = z.string().min(1).max(128);

const worstCaseSchema = z
  .object({
    currency: z.enum(['EUR', 'USD']),
    amount: z.number().finite().nonnegative(),
  })
  .strict();

export const CreateApprovalInputSchema = z
  .object({
    aiId: aiIdSchema,
    groupId: groupIdSchema,
    topicId: topicIdSchema,
    action: actionSchema,
    summary: summarySchema,
    details: detailsSchema,
    argsHash: argsHashSchema,
    worstCase: worstCaseSchema.optional(),
    requestedBy: requestedBySchema,
    expiresAt: z.date(),
  })
  .strict()
  // T-0110: the scope is (AI, topic) — group and topic ids travel together.
  .refine((data) => (data.groupId === undefined) === (data.topicId === undefined), {
    message: 'groupId and topicId must be set together',
  });

export type CreateApprovalInput = z.infer<typeof CreateApprovalInputSchema>;

// T-0099: the predicate the routes pass to `decideApproval` so the
// service can accept or refuse an `approve_always` decision. Absent =
// "nothing is always-eligible", so `approve_always` is refused with 400
// `always_not_allowed`.
export type AlwaysEligiblePredicate = (action: string) => boolean;

// T-0099: the result of an `approve_always` decision, returned by the
// service so the route can write the matching audit entries (one for
// `approval.decided` and one for `approval_rule.created`). The decision
// itself is still a normal approval — the rule sits next to it.
export interface CreatedApprovalRule {
  id: string;
  action: string;
  groupId: string | null;
  topicId: string | null;
  created: boolean;
}

export interface PublicApproval {
  id: string;
  aiId: string;
  groupId: string | null;
  /** The topic the request was raised in. Null for personal chats. */
  topicId: string | null;
  /** The topic's name, or null for personal chats. The route blanks this
   *  for topics the viewer cannot see (which cannot happen for a returned
   *  row); the field stays for the client. */
  topicName: string | null;
  action: string;
  summary: string;
  details: string | null;
  argsHash: string;
  worstCase: { currency: 'EUR' | 'USD'; amount: number } | null;
  requestedBy: string;
  status: ApprovalStatus | 'expired';
  decidedAt: Date | null;
  note: string | null;
  expiresAt: Date;
  createdAt: Date;
  // T-0099: `true` when the action is on the always-eligible list (the
  // adapter opted in via `allowAlways: true` and reports no cost). The
  // client uses this to decide whether to show the "Approve always"
  // button.
  alwaysEligible: boolean;
  // T-0134: the display names of the holders of the topic's approver role,
  // resolved server-side so the card does not call `getTopic` per approval
  // (N+1). Sorted by name, empty for personal chats and topics without an
  // approver role. Only topics the viewer can see ever reach the list, and
  // role membership is not secret, so no names leak.
  approverNames: string[];
}

export interface ApprovalVerifyResult {
  ok: boolean;
  decision?: ApprovalDecision;
}

// Thrown for validation and quota failures so routes can map them to 4xx with
// stable codes. Unknown or unauthorised ids return null instead, so routes
// answer 404.
export class ApprovalServiceError extends Error {
  readonly errorCode:
    | 'invalid_request'
    | 'expired'
    | 'not_pending'
    | 'pending_limit'
    | 'ai_not_in_group'
    | 'always_not_allowed'
    | 'always_requires_admin';

  constructor(errorCode: ApprovalServiceError['errorCode'], message: string) {
    super(message);
    this.name = 'ApprovalServiceError';
    this.errorCode = errorCode;
  }
}

type ApprovalRow = typeof approvals.$inferSelect;

// Validates input at the boundary and writes one row. The AI must exist; if
// `groupId` is set, `topicId` must name a topic of that group (both set or
// both absent — personal chat). `expiresAt` must be in the future and at
// most 24 hours ahead. Per-AI pending cap is 50.
export async function createApproval(
  db: ServerDatabase,
  input: CreateApprovalInput,
  now: Date,
): Promise<ApprovalRow> {
  const parsed = CreateApprovalInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApprovalServiceError(
      'invalid_request',
      parsed.error.issues[0]?.message ?? 'Invalid approval request',
    );
  }
  const data = parsed.data;

  if (data.expiresAt.getTime() <= now.getTime()) {
    throw new ApprovalServiceError('invalid_request', 'expires_at must be in the future');
  }
  if (data.expiresAt.getTime() - now.getTime() > MAX_APPROVAL_EXPIRY_MS) {
    throw new ApprovalServiceError(
      'invalid_request',
      'expires_at must be at most 24 hours in the future',
    );
  }

  const [ai] = await db.select({ id: ais.id }).from(ais).where(eq(ais.id, data.aiId)).limit(1);
  if (!ai) {
    throw new ApprovalServiceError('invalid_request', 'Unknown AI');
  }

  if (data.groupId !== undefined) {
    const [link] = await db
      .select({ aiId: groupAis.aiId })
      .from(groupAis)
      .where(and(eq(groupAis.groupId, data.groupId), eq(groupAis.aiId, data.aiId)))
      .limit(1);
    if (!link) {
      throw new ApprovalServiceError('ai_not_in_group', 'The AI is not in that topic');
    }
    // The topic must belong to the group; the AI's membership of the topic
    // is checked by the gateway before this service is reached.
    const [topic] = await db
      .select({ id: topics.id, groupId: topics.groupId })
      .from(topics)
      .where(eq(topics.id, data.topicId as string))
      .limit(1);
    if (!topic || topic.groupId !== data.groupId) {
      throw new ApprovalServiceError('ai_not_in_group', 'The AI is not in that topic');
    }
  }

  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(approvals)
    .where(and(eq(approvals.aiId, data.aiId), eq(approvals.status, 'pending')));
  if (Number(total ?? 0) >= MAX_PENDING_APPROVALS_PER_AI) {
    throw new ApprovalServiceError(
      'pending_limit',
      `At most ${MAX_PENDING_APPROVALS_PER_AI} pending approvals per AI`,
    );
  }

  const id = randomUUID();
  const row: typeof approvals.$inferInsert = {
    id,
    aiId: data.aiId,
    groupId: data.groupId ?? null,
    topicId: data.topicId ?? null,
    action: data.action,
    summary: data.summary,
    details: data.details ?? null,
    argsHash: data.argsHash,
    worstCaseCurrency: data.worstCase?.currency ?? null,
    worstCaseAmount: data.worstCase?.amount.toFixed(2) ?? null,
    requestedBy: data.requestedBy,
    status: 'pending',
    expiresAt: data.expiresAt,
  };
  const [created] = await db.insert(approvals).values(row).returning();
  if (!created) {
    throw new Error('Failed to create approval');
  }
  return created;
}

// Atomically decides a pending, unexpired request, but only if `userId` may
// decide it (AI owner, or group owner/admin when the request was raised in a
// group). A user who may not decide gets the same null as a missing id, so
// existence is never leaked. Two racing decisions: the conditional update
// makes exactly one win.
//
// T-0099: when `decision === 'approve_always'` and `alwaysEligible(action)`
// is `true`, an `approval_rules` row is created in the same transaction.
// The decision itself still proceeds: the request runs once (the existing
// `onDecided` path), and the rule applies to future matching requests.
export interface DecideApprovalResult {
  row: ApprovalRow;
  rule: CreatedApprovalRule | null;
}

export async function decideApproval(
  db: ServerDatabase,
  params: {
    approvalId: string;
    userId: string;
    decision: ApprovalDecision;
    note?: string;
    alwaysEligible?: AlwaysEligiblePredicate;
  },
  now: Date,
): Promise<DecideApprovalResult | null> {
  const noteParsed = noteSchema.safeParse(params.note);
  if (!noteParsed.success) {
    throw new ApprovalServiceError('invalid_request', 'Invalid note');
  }

  const [row] = await db
    .select()
    .from(approvals)
    .where(eq(approvals.id, params.approvalId))
    .limit(1);
  if (!row) {
    return null;
  }
  // Authorisation comes first: a caller who may not decide must not learn
  // whether the request is expired or already decided.
  if (!(await canDecide(db, row, params.userId))) {
    return null;
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    throw new ApprovalServiceError('expired', 'Approval request has expired');
  }
  if (row.status !== 'pending') {
    throw new ApprovalServiceError('not_pending', 'Approval request has already been decided');
  }

  // T-0099: an "approve_always" decision that cannot create a rule (the
  // action is unknown, the adapter opted out, or the adapter reports a
  // cost) is refused before the row is updated so no state changes.
  // T-0101: for a group approval the decider must also be a group
  // owner/admin; a personal-chat approval needs no group check.
  if (params.decision === 'approve_always') {
    const eligible = params.alwaysEligible ?? (() => false);
    if (!eligible(row.action)) {
      throw new ApprovalServiceError(
        'always_not_allowed',
        `Action "${row.action}" cannot be always-allowed`,
      );
    }
    if (row.groupId !== null && !(await isGroupAdmin(db, row.groupId, params.userId))) {
      throw new ApprovalServiceError(
        'always_requires_admin',
        'Only a group admin can always allow an action in this group',
      );
    }
  }

  // The decision + (optional) rule creation share one transaction. If
  // either fails, both roll back.
  let createdRule: CreatedApprovalRule | null = null;
  const updated = await db.transaction(async (tx) => {
    const [decisionRow] = await tx
      .update(approvals)
      .set({
        status: decisionToStatus(params.decision),
        decidedBy: params.userId,
        decidedAt: now,
        note: params.note ?? null,
      })
      .where(
        and(
          eq(approvals.id, row.id),
          eq(approvals.status, 'pending'),
          gt(approvals.expiresAt, now),
        ),
      )
      .returning();
    if (!decisionRow) {
      // A concurrent decision won, or the row expired between our
      // checks and the update. Signal "no row updated" so the caller
      // can re-read and pick the right error.
      return undefined;
    }

    if (params.decision === 'approve_always') {
      // The rule shares the decision's transaction: both commit or neither.
      const { rule, created } = await createRule(
        tx as unknown as ServerDatabase,
        {
          aiId: row.aiId,
          groupId: row.groupId,
          topicId: row.topicId,
          action: row.action,
          createdBy: params.userId,
        },
        now,
      );
      createdRule = {
        id: rule.id,
        action: rule.action,
        groupId: rule.groupId,
        topicId: rule.topicId,
        created,
      };
    }

    return decisionRow;
  });

  if (!updated) {
    // A concurrent decision won, or the row expired between our checks and the
    // update. Re-read to give the caller a stable error.
    const [fresh] = await db.select().from(approvals).where(eq(approvals.id, row.id)).limit(1);
    if (!fresh) {
      return null;
    }
    if (fresh.expiresAt.getTime() <= now.getTime()) {
      throw new ApprovalServiceError('expired', 'Approval request has expired');
    }
    throw new ApprovalServiceError('not_pending', 'Approval request has already been decided');
  }
  return { row: updated, rule: createdRule };
}

// Verifies an approval for the engine. Returns `{ ok: true, decision }` only
// when the request is `approved_once` or `approved_always`, unexpired, and
// `argsHash` matches the stored hash (compared with `timingSafeEqual` so the
// answer cannot be used to recover the hash byte by byte). For both
// approvals the status is flipped to `consumed` with a conditional update so a second
// call fails. Any other state — wrong hash, not decided, denied, expired,
// already consumed — returns `{ ok: false }` with no detail.
//
// `approved_always` is treated like `approved_once` here on purpose: standing
// rules (always-allow for one action across requests) are a separate spec and
// the current behaviour is to make every approval consume.
export async function verifyApproval(
  db: ServerDatabase,
  params: { approvalId: string; argsHash: string },
  now: Date,
): Promise<ApprovalVerifyResult> {
  const [row] = await db
    .select()
    .from(approvals)
    .where(eq(approvals.id, params.approvalId))
    .limit(1);
  if (!row) {
    return { ok: false };
  }
  if (row.status !== 'approved_once' && row.status !== 'approved_always') {
    return { ok: false };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false };
  }
  if (!safeHashEquals(row.argsHash, params.argsHash)) {
    return { ok: false };
  }

  const [consumed] = await db
    .update(approvals)
    .set({ status: 'consumed' })
    .where(and(eq(approvals.id, row.id), eq(approvals.status, row.status)))
    .returning();
  if (!consumed) {
    return { ok: false };
  }
  return {
    ok: true,
    decision: row.status === 'approved_always' ? 'approve_always' : 'approve_once',
  };
}

// The approver-role holder names for a batch of topics, keyed by topic id.
// One batched query for the whole list response — never one query per row.
// Only holders who are still group members are named (a departed user is
// never listed even if their row survived the leave cleanup); topics
// without an approver role get no entry (callers map them to `[]`). One
// role may approve several topics: holder names fan out to every topic
// sharing the role.
export async function approverNamesForTopics(
  db: ServerDatabase,
  topicIds: Array<string | null>,
): Promise<Map<string, string[]>> {
  const unique = [...new Set(topicIds.filter((id): id is string => id !== null))];
  const names = new Map<string, string[]>();
  if (unique.length === 0) {
    return names;
  }
  const topicRows = await db.select().from(topics).where(inArray(topics.id, unique));
  const withRole = topicRows.filter((topic) => topic.approverRoleId !== null);
  if (withRole.length === 0) {
    return names;
  }
  const roleToTopics = new Map<string, string[]>();
  for (const topic of withRole) {
    const roleId = topic.approverRoleId as string;
    const list = roleToTopics.get(roleId) ?? [];
    list.push(topic.id);
    roleToTopics.set(roleId, list);
  }
  const holderRows = await db
    .select({ roleId: groupMemberRoles.roleId, name: user.name, userId: user.id })
    .from(groupMemberRoles)
    .innerJoin(user, eq(user.id, groupMemberRoles.userId))
    .innerJoin(groupRoles, eq(groupRoles.id, groupMemberRoles.roleId))
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, groupRoles.groupId),
        eq(groupMembers.userId, groupMemberRoles.userId),
      ),
    )
    .where(inArray(groupMemberRoles.roleId, [...roleToTopics.keys()]));
  const byTopic = new Map<string, Array<{ name: string; userId: string }>>();
  for (const row of holderRows) {
    const topicIds = roleToTopics.get(row.roleId) ?? [];
    for (const topicId of topicIds) {
      const list = byTopic.get(topicId) ?? [];
      list.push({ name: row.name, userId: row.userId });
      byTopic.set(topicId, list);
    }
  }
  for (const [topicId, holders] of byTopic) {
    holders.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
    names.set(
      topicId,
      holders.map((holder) => holder.name),
    );
  }
  return names;
}

// Lists the pending, unexpired approval requests `userId` may decide: their
// own AIs, plus groups they own or administer — in both cases only for
// topics they can see (a blind admin never counts a private topic's rows).
// Newest first, capped at 100.
export async function listDecidableApprovals(
  db: ServerDatabase,
  userId: string,
  now: Date,
): Promise<PublicApproval[]> {
  const allowedAiIds = await decidableAiIdsForUser(db, userId);
  const allowedGroupIds = await decidableGroupIdsForUser(db, userId);

  const conditions = [];
  if (allowedAiIds.length > 0) {
    conditions.push(
      and(
        eq(approvals.status, 'pending'),
        gt(approvals.expiresAt, now),
        inArray(approvals.aiId, allowedAiIds),
      ),
    );
  }
  if (allowedGroupIds.length > 0) {
    conditions.push(
      and(
        eq(approvals.status, 'pending'),
        gt(approvals.expiresAt, now),
        inArray(approvals.groupId, allowedGroupIds),
      ),
    );
  }
  if (conditions.length === 0) {
    return [];
  }

  const rows = await db
    .select()
    .from(approvals)
    .where(or(...conditions))
    .orderBy(desc(approvals.createdAt))
    .limit(100);
  // A group admin who cannot see a private topic must not count its rows
  // in the pending badge: drop anything outside their visible topics.
  // Approver names ride the same batch so the card needs no extra read.
  const approverNames = await approverNamesForTopics(
    db,
    rows.map((row) => row.topicId),
  );
  const visible = [];
  for (const row of rows) {
    if (await canDecide(db, row, userId)) {
      visible.push(toPublicApproval(row, now, false, null, approverNamesFor(row, approverNames)));
    }
  }
  return visible;
}

function approverNamesFor(row: { topicId: string | null }, names: Map<string, string[]>): string[] {
  return row.topicId === null ? [] : (names.get(row.topicId) ?? []);
}

// One request by id, visible only to a user who may decide it. The read model
// maps a past-due `pending` row to `expired` without writing.
export async function getDecidableApproval(
  db: ServerDatabase,
  approvalId: string,
  userId: string,
  now: Date,
): Promise<PublicApproval | null> {
  const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1);
  if (!row) {
    return null;
  }
  if (!(await canDecide(db, row, userId))) {
    return null;
  }
  const names = await approverNamesForTopics(db, [row.topicId]);
  return toPublicApproval(row, now, false, null, approverNamesFor(row, names));
}

// Used by the future sweeper (and the tests). Marks past-due `pending` rows
// `denied` with `note = 'expired'` so the read model and a hard `pending`
// query agree. Returns the swept rows' ids and AI/group ids so the sweeper
// can write one audit entry per row. The conditional `WHERE` keeps a
// concurrent decision from being overwritten.
export async function expireStale(
  db: ServerDatabase,
  now: Date,
): Promise<Array<{ id: string; aiId: string; groupId: string | null }>> {
  const updated = await db
    .update(approvals)
    .set({ status: 'denied', decidedAt: now, note: 'expired' })
    .where(and(eq(approvals.status, 'pending'), lt(approvals.expiresAt, now)))
    .returning();
  return updated.map((row) => ({ id: row.id, aiId: row.aiId, groupId: row.groupId }));
}

// Whether `userId` may decide `row`: the AI owner, or — when the request
// was raised in a topic — that group's owner or admin who can also see the
// topic. T-0116: or a holder of the topic's approver role who can see the
// topic. A group admin who cannot see a private topic gets the same false
// as a missing id, so existence is never leaked. The AI owner keeps
// deciding only while they can see the topic.
export async function canDecide(
  db: ServerDatabase,
  row: ApprovalRow,
  userId: string,
): Promise<boolean> {
  const [ai] = await db.select({ owner: ais.owner }).from(ais).where(eq(ais.id, row.aiId)).limit(1);
  if (!ai) {
    return false;
  }
  if (row.topicId !== null) {
    const [topic] = await db.select().from(topics).where(eq(topics.id, row.topicId)).limit(1);
    if (!topic || !(await canSeeTopic(db, topic, userId))) {
      return false;
    }
    // The approver role grants decide rights and nothing else: the holder
    // must see the topic (checked above), and the role never widens AI
    // management, rules or other topics. The join ties the role to the
    // approval's group, so the check is self-sufficient even if a stale
    // membership row ever survived a group leave. (`topicId` set implies
    // `groupId` set by the topic-scope CHECK; the guard below is for the
    // type checker.)
    if (topic.approverRoleId !== null && row.groupId !== null) {
      const groupId = row.groupId;
      const [held] = await db
        .select({ userId: groupMemberRoles.userId })
        .from(groupMemberRoles)
        .innerJoin(groupRoles, eq(groupRoles.id, groupMemberRoles.roleId))
        .where(
          and(
            eq(groupMemberRoles.roleId, topic.approverRoleId),
            eq(groupMemberRoles.userId, userId),
            eq(groupRoles.groupId, groupId),
          ),
        )
        .limit(1);
      if (held) {
        return true;
      }
    }
  }
  if (ai.owner === userId) {
    return true;
  }
  if (row.groupId === null) {
    return false;
  }
  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, row.groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return membership !== undefined && (membership.role === 'owner' || membership.role === 'admin');
}

function decidableAiIdsForUser(db: ServerDatabase, userId: string): Promise<string[]> {
  return db
    .select({ id: ais.id })
    .from(ais)
    .where(eq(ais.owner, userId))
    .then((rows) => rows.map((row) => row.id));
}

async function decidableGroupIdsForUser(db: ServerDatabase, userId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.userId, userId),
        or(eq(groupMembers.role, 'owner'), eq(groupMembers.role, 'admin')),
      ),
    );
  return rows.map((row) => row.groupId);
}

// The read shape: a past-due `pending` row is mapped to `expired` without
// writing, and so is a row the sweeper already denied (`denied`, note
// `expired`, no human decider): the reader must not see "Denied" for a request
// nobody denied. `decided_by` is intentionally omitted.
//
// `alwaysEligible` is supplied by the caller because the service does not
// own the action registry — the gateway does. The route passes the
// predicate it built from the registry.
// `topicName` is supplied by the caller (the route) because the service
// does not gate visibility — the route passes the name only for topics the
// viewer can see, else null. Same for `approverNames`: the list/single
// readers above resolve them, and the decision route resolves them for the
// decided row.
export function toPublicApproval(
  row: ApprovalRow,
  now: Date,
  alwaysEligible: boolean = false,
  topicName: string | null = null,
  approverNames: string[] = [],
): PublicApproval {
  const isPending = row.status === 'pending';
  const sweptByTimer = row.status === 'denied' && row.note === 'expired' && row.decidedBy === null;
  const status: ApprovalStatus | 'expired' =
    sweptByTimer || (isPending && row.expiresAt.getTime() <= now.getTime())
      ? 'expired'
      : row.status;

  const hasWorstCase = row.worstCaseCurrency !== null && row.worstCaseAmount !== null;
  const worstCase = hasWorstCase
    ? {
        currency: row.worstCaseCurrency as 'EUR' | 'USD',
        amount: Number(row.worstCaseAmount),
      }
    : null;

  return {
    id: row.id,
    aiId: row.aiId,
    groupId: row.groupId,
    topicId: row.topicId,
    topicName,
    approverNames,
    action: row.action,
    summary: row.summary,
    details: row.details,
    argsHash: row.argsHash,
    worstCase,
    requestedBy: row.requestedBy,
    status,
    decidedAt: row.decidedAt,
    note: row.note,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    alwaysEligible,
  };
}

// Constant-time hash equality. Different lengths return false without ever
// touching `timingSafeEqual` (which would throw).
function safeHashEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length === 0 || aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

// The wire enum (`approve_once` / `approve_always` / `deny`) and the column
// enum (`approved_once` / `approved_always` / `denied`) are spelled apart on
// purpose, so the API stays in protocol shape while the row stays in storage
// shape.
function decisionToStatus(
  decision: ApprovalDecision,
): 'approved_once' | 'approved_always' | 'denied' {
  switch (decision) {
    case 'approve_once':
      return 'approved_once';
    case 'approve_always':
      return 'approved_always';
    case 'deny':
      return 'denied';
  }
}
