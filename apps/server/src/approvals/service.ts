import { randomUUID, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { ARGS_HASH_PATTERN } from '@galena/protocol';
import type { ServerDatabase } from '../db/client';
import { ais, approvals, groupAis, groupMembers } from '../db/schema';
import { createRule } from './rules';

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
    action: actionSchema,
    summary: summarySchema,
    details: detailsSchema,
    argsHash: argsHashSchema,
    worstCase: worstCaseSchema.optional(),
    requestedBy: requestedBySchema,
    expiresAt: z.date(),
  })
  .strict();

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
  created: boolean;
}

export interface PublicApproval {
  id: string;
  aiId: string;
  groupId: string | null;
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
    | 'always_not_allowed';

  constructor(errorCode: ApprovalServiceError['errorCode'], message: string) {
    super(message);
    this.name = 'ApprovalServiceError';
    this.errorCode = errorCode;
  }
}

type ApprovalRow = typeof approvals.$inferSelect;

// Validates input at the boundary and writes one row. The AI must exist; if
// `groupId` is set, the AI must be an AI of that group. `expiresAt` must be in
// the future and at most 24 hours ahead. Per-AI pending cap is 50.
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
      throw new ApprovalServiceError('ai_not_in_group', 'AI is not in that group');
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
  if (params.decision === 'approve_always') {
    const eligible = params.alwaysEligible ?? (() => false);
    if (!eligible(row.action)) {
      throw new ApprovalServiceError(
        'always_not_allowed',
        `Action "${row.action}" cannot be always-allowed`,
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
        { aiId: row.aiId, groupId: row.groupId, action: row.action, createdBy: params.userId },
        now,
      );
      createdRule = { id: rule.id, action: rule.action, groupId: rule.groupId, created };
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

// Lists the pending, unexpired approval requests `userId` may decide: their
// own AIs, plus groups they own or administer. Newest first, capped at 100.
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
  return rows.map((row) => toPublicApproval(row, now));
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
  return toPublicApproval(row, now);
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

// Whether `userId` may decide `row`: the AI owner, or — when the request was
// raised in a group — that group's owner or admin.
export async function canDecide(
  db: ServerDatabase,
  row: ApprovalRow,
  userId: string,
): Promise<boolean> {
  const [ai] = await db.select({ owner: ais.owner }).from(ais).where(eq(ais.id, row.aiId)).limit(1);
  if (!ai) {
    return false;
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
export function toPublicApproval(
  row: ApprovalRow,
  now: Date,
  alwaysEligible: boolean = false,
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
