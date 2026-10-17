// effect-plain: the Promise edge over the async routine helpers; a routine
// failure is logged and never fails the card answer.
// T-1856: an answer on an alert card that is linked to a routine changes that
// routine. The threshold lands in `input.threshold`, off pauses it, and on
// resumes it only when the person paused it — a failure, hosts or approval
// pause stays put, and the card keeps the switch the person set. The routine
// side is best-effort: errors are logged with ids only and never fail the
// answer.
import type { Logger } from 'pino';
import type { ServerDatabase } from '../db/client';
import type { BlockCardRow } from '../db/rows';
import { errorName } from '../effect/error-utils';
import { findAlertRoutine, setRoutineThreshold } from '../routines/alert-link';
import { pauseRoutine, resumeRoutine } from '../routines/support';

export interface AlertRoutineDeps {
  db: ServerDatabase;
  logger: Logger;
}

// The same strip rule the card answer uses: spaces, commas and one leading
// currency sign. `respond.ts` has already rejected anything else.
function parseThreshold(text: string): number {
  return Number(text.replace(/[ ,]/g, '').replace(/^[$€£]/, ''));
}

// Applies one recorded alert answer to the routine linked to this card block.
// No link means nothing happens.
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
      await pauseRoutine(deps.db, routine.id, actorId, now);
    } else if (on === true && routine.pausedReason === 'user') {
      await resumeRoutine(deps.db, routine.id, actorId, now);
    }
  } catch (error) {
    deps.logger.warn(
      { cardId: card.originId, blockId, err: errorName(error) },
      'Alert answer did not reach the routine',
    );
  }
}
