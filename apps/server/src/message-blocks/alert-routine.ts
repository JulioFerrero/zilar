// effect-plain: a routine failure is logged and never fails the card answer.
//
// An alert answer changes its linked routine: the threshold, off pauses, and on
// resumes only when the person paused it. Only the routine's manager may answer
// a linked alert; anyone else gets the card's usual 404. Pause and resume are
// audited.
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerDatabase } from '../db/client';
import type { BlockCardRow } from '../db/rows';
import { errorName } from '../effect/error-utils';
import { HttpError } from '../errors';
import { routineAccess } from '../routines/access';
import { findAlertRoutine, setRoutineThreshold } from '../routines/alert-link';
import { pauseRoutine, resumeRoutine } from '../routines/support';

export interface AlertRoutineDeps {
  db: ServerDatabase;
  logger: Logger;
  audit?: AuditRecorder;
}

// An unknown card and a card the caller may not answer read the same, so ids
// cannot be probed.
function cardNotFound(): HttpError {
  return new HttpError(404, 'card_not_found', 'Card not found');
}

// An unlinked alert has no manager; a linked one is answerable only by the
// routine's manager (the AI owner, or a group owner/admin).
export async function requireAlertManager(
  db: ServerDatabase,
  cardId: string,
  blockId: string,
  userId: string,
): Promise<void> {
  const routine = await findAlertRoutine(db, cardId, blockId);
  if (routine === undefined) {
    return;
  }
  const access = await routineAccess(db, routine.id, userId);
  if (access?.manager !== true) {
    throw cardNotFound();
  }
}

// The same strip rule as `respond.ts`, which already rejected anything else.
function parseThreshold(text: string): number {
  return Number(text.replace(/[ ,]/g, '').replace(/^[$€£]/, ''));
}

export async function applyAlertToRoutine(
  deps: AlertRoutineDeps,
  card: BlockCardRow,
  blockId: string,
  actorId: string,
  value: Record<string, unknown>,
): Promise<void> {
  try {
    const routine = await findAlertRoutine(deps.db, card.originId, blockId);
    if (routine === undefined) {
      return;
    }
    const now = new Date();
    const threshold = typeof value.threshold === 'string' ? value.threshold : undefined;
    if (threshold !== undefined) {
      await setRoutineThreshold(deps.db, routine.id, parseThreshold(threshold), now);
    }
    const on = value.on;
    if (on === false) {
      await pauseRoutine(deps.db, routine.id, actorId, now, deps.audit);
    } else if (on === true && routine.pausedReason === 'user') {
      await resumeRoutine(deps.db, routine.id, actorId, now, deps.audit);
    }
  } catch (error) {
    deps.logger.warn(
      { cardId: card.originId, blockId, err: errorName(error) },
      'Alert answer did not reach the routine',
    );
  }
}
