import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  ApprovalServiceError,
  decideApproval,
  getDecidableApproval,
  listDecidableApprovals,
  toPublicApproval,
} from './service';

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
}: ApprovalsRoutesDependencies): Hono {
  const routes = new Hono();

  routes.get('/approvals', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const approvals = await listDecidableApprovals(db, user.id, new Date(now()));
    return c.json(approvals);
  });

  routes.get('/approvals/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const approval = await getDecidableApproval(db, c.req.param('id'), user.id, new Date(now()));
    if (!approval) {
      throw new HttpError(404, 'not_found', 'Approval not found');
    }
    return c.json(approval);
  });

  routes.post('/approvals/:id/decision', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const parsed = decisionSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid decision body');
    }
    try {
      const updated = await decideApproval(
        db,
        {
          approvalId: c.req.param('id'),
          userId: user.id,
          decision: parsed.data.decision,
          ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
        },
        new Date(now()),
      );
      if (!updated) {
        throw new HttpError(404, 'not_found', 'Approval not found');
      }
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
      return c.json(toPublicApproval(updated, new Date(now())));
    } catch (error) {
      if (error instanceof ApprovalServiceError) {
        const status =
          error.errorCode === 'expired' || error.errorCode === 'not_pending' ? 409 : 400;
        throw new HttpError(status, error.errorCode, error.message);
      }
      throw error;
    }
  });

  return routes;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
  }
}
