import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { ais, approvalRules, groupMembers } from '../db/schema';
import { HttpError } from '../errors';
import {
  ApprovalServiceError,
  type AlwaysEligiblePredicate,
  decideApproval,
  getDecidableApproval,
  listDecidableApprovals,
  toPublicApproval,
} from './service';
import { isGroupAdmin, listActiveRulesForAi, listActiveRulesForGroup, revokeRule } from './rules';

// The minimum slice of pino the route needs to log a hook failure. The
// server wires its own logger; tests can pass a captor.
export interface ApprovalsRouteLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface ApprovalsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  /** Audit recorder; production wires the server's own recorder, real tests
   *  pass a recorder pointed at the test database, the live-check test passes
   *  one whose failures are observed. */
  audit?: AuditRecorder;
  now?: () => number;
  /** Logger used to record a hook failure; absent = silent. */
  logger?: ApprovalsRouteLogger;
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

// The decision body. `strictObject` so an unknown key is rejected rather than
// silently dropped, and `note` is bounded like the protocol schema.
const decisionSchema = z
  .object({
    decision: z.enum(['approve_once', 'approve_always', 'deny']),
    note: z.string().max(500).optional(),
  })
  .strict();

export function createApprovalsRoutes({
  auth,
  db,
  audit,
  now = Date.now,
  logger,
  onDecided,
  alwaysEligible,
}: ApprovalsRoutesDependencies): Hono {
  const routes = new Hono();
  const alwaysEligibleFn = alwaysEligible ?? ((_action: string) => false);

  routes.get('/approvals', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const approvals = await listDecidableApprovals(db, user.id, new Date(now()));
    const managedGroupIds = await managedGroupIdsForUser(db, user.id);
    return c.json(
      approvals.map((row) =>
        decoratePublic(
          row,
          alwaysEligibleFn,
          row.groupId === null || managedGroupIds.has(row.groupId),
        ),
      ),
    );
  });

  routes.get('/approvals/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const approval = await getDecidableApproval(db, c.req.param('id'), user.id, new Date(now()));
    if (!approval) {
      throw new HttpError(404, 'not_found', 'Approval not found');
    }
    const isManager =
      approval.groupId === null || (await isGroupAdmin(db, approval.groupId, user.id));
    return c.json(decoratePublic(approval, alwaysEligibleFn, isManager));
  });

  routes.post('/approvals/:id/decision', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const parsed = decisionSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid decision body');
    }
    try {
      const result = await decideApproval(
        db,
        {
          approvalId: c.req.param('id'),
          userId: user.id,
          decision: parsed.data.decision,
          ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
          alwaysEligible: alwaysEligibleFn,
        },
        new Date(now()),
      );
      if (!result) {
        throw new HttpError(404, 'not_found', 'Approval not found');
      }
      const { row: updated, rule } = result;
      // A 409 (already decided / expired) is not logged; an ok decision
      // always is. `note` is intentionally dropped: the audit log must never
      // carry free text. `detail.decision` uses the wire enum so the log
      // matches what the request sent.
      if (audit !== undefined) {
        await audit.record({
          actorUserId: user.id,
          aiId: updated.aiId,
          groupId: updated.groupId,
          action: 'approval.decided',
          subjectId: updated.id,
          argsHash: updated.argsHash,
          costCurrency: null,
          costAmount: null,
          result: 'ok',
          detail: { decision: parsed.data.decision },
        });
        // T-0099: when `approve_always` succeeded, audit the rule creation
        // as a separate entry. Subject is the rule id, not the approval id,
        // so an audit reader can join the two. `detail.scope` makes the
        // personal-vs-group chat obvious without exposing the id.
        if (rule !== null) {
          await audit.record({
            actorUserId: user.id,
            aiId: updated.aiId,
            groupId: updated.groupId,
            action: 'approval_rule.created',
            subjectId: rule.id,
            argsHash: null,
            costCurrency: null,
            costAmount: null,
            result: 'ok',
            detail: {
              action: rule.action,
              scope: rule.groupId === null ? 'personal' : 'group',
            },
          });
        }
      }
      // Fire-and-forget hook: the response is returned to the user before
      // the hook settles, and a throwing hook is logged rather than
      // surfaced. The action gateway uses this to execute a pending
      // action; a throw there must not turn a 200 into a 5xx for the user
      // who just approved the request.
      if (onDecided !== undefined) {
        void Promise.resolve()
          .then(() => onDecided(updated.id))
          .catch((error: unknown) => {
            if (logger !== undefined) {
              const name = error instanceof Error ? error.name : typeof error;
              logger.error({ err: name, approvalId: updated.id }, 'onDecided hook threw');
            }
          });
      }
      return c.json(
        decoratePublic(
          toPublicApproval(updated, new Date(now())),
          alwaysEligibleFn,
          updated.groupId === null || (await isGroupAdmin(db, updated.groupId, user.id)),
        ),
      );
    } catch (error) {
      if (error instanceof ApprovalServiceError) {
        const status =
          error.errorCode === 'expired' || error.errorCode === 'not_pending'
            ? 409
            : error.errorCode === 'always_requires_admin'
              ? 403
              : 400;
        throw new HttpError(status, error.errorCode, error.message);
      }
      throw error;
    }
  });

  // T-0099: rule management routes. All three require a session.
  routes.get('/ais/:id/approval-rules', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const aiId = c.req.param('id');
    const [aiRow] = await db
      .select({ id: ais.id, owner: ais.owner })
      .from(ais)
      .where(eq(ais.id, aiId))
      .limit(1);
    // A stranger and a non-owner get the same 404 as a missing AI, so
    // existence is never leaked.
    if (!aiRow || aiRow.owner !== user.id) {
      throw new HttpError(404, 'not_found', 'AI not found');
    }
    const rules = await listActiveRulesForAi(db, aiId);
    return c.json(rules);
  });

  routes.get('/groups/:id/approval-rules', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const groupId = c.req.param('id');
    const allowed = await isGroupAdmin(db, groupId, user.id);
    if (!allowed) {
      throw new HttpError(404, 'not_found', 'Group not found');
    }
    const rules = await listActiveRulesForGroup(db, groupId);
    return c.json(rules);
  });

  routes.delete('/approval-rules/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const ruleId = c.req.param('id');
    const [existing] = await db
      .select()
      .from(approvalRules)
      .where(eq(approvalRules.id, ruleId))
      .limit(1);
    // Same 404 shape for missing id and unauthorized: existence is never
    // leaked.
    if (!existing) {
      throw new HttpError(404, 'not_found', 'Approval rule not found');
    }
    const allowed = await canManageRuleFor(db, existing, user.id);
    if (!allowed) {
      throw new HttpError(404, 'not_found', 'Approval rule not found');
    }
    const result = await revokeRule(db, {
      ruleId,
      actorId: user.id,
      now: new Date(now()),
    });
    // `revokeRule` returns `null` only when the row vanished mid-call;
    // an already-revoked row returns its data and we answer 204.
    if (result === null) {
      throw new HttpError(404, 'not_found', 'Approval rule not found');
    }
    const { row: revokedRow } = result;
    if (audit !== undefined) {
      await audit.record({
        actorUserId: user.id,
        aiId: revokedRow.aiId,
        groupId: revokedRow.groupId,
        action: 'approval_rule.revoked',
        subjectId: revokedRow.id,
        argsHash: null,
        costCurrency: null,
        costAmount: null,
        result: 'ok',
        detail: {
          action: revokedRow.action,
          scope: revokedRow.groupId === null ? 'personal' : 'group',
        },
      });
    }
    return c.body(null, 204);
  });

  return routes;
}

// Looks up the AI ownership directly and adds the group-admin check via
// the rules module. Kept in this file because it composes the two
// checks the route needs in one place.
async function canManageRuleFor(
  db: ServerDatabase,
  rule: typeof approvalRules.$inferSelect,
  userId: string,
): Promise<boolean> {
  const [aiRow] = await db
    .select({ owner: ais.owner })
    .from(ais)
    .where(eq(ais.id, rule.aiId))
    .limit(1);
  if (aiRow && aiRow.owner === userId) {
    return true;
  }
  if (rule.groupId === null) {
    // Personal rule and the caller is not the AI owner: not allowed.
    return false;
  }
  return isGroupAdmin(db, rule.groupId, userId);
}

// Re-runs `toPublicApproval` with the always-eligible flag filled in.
// The service returns `alwaysEligible: false` because it does not own
// the registry; the route is the boundary that knows. T-0101: the flag
// is per viewer — a group approval is only always-eligible for a group
// owner/admin (`isManager`), since only they may create a group rule.
// Personal-chat approvals need no group check (`isManager` is `true`).
function decoratePublic(
  row: ReturnType<typeof toPublicApproval>,
  alwaysEligible: AlwaysEligiblePredicate,
  isManager: boolean,
): ReturnType<typeof toPublicApproval> {
  return { ...row, alwaysEligible: isManager && alwaysEligible(row.action) };
}

// The group ids where the user is an owner/admin. One query for the
// whole list response — never one query per row.
async function managedGroupIdsForUser(db: ServerDatabase, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, userId), inArray(groupMembers.role, ['owner', 'admin'])));
  return new Set(rows.map((row) => row.groupId));
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
  }
}
