// effect-plain: the Promise edge over the owner-scoped AI read and the
// gateway's synchronous `stopTurn`, like the other AI route helpers.
// T-1422: the stop-turn route handler. `POST /api/ais/:id/turns/stop` with
// `{ chatJid }` aborts the turn running in that chat (a DM or a room), the
// same way the owner's kill switch stays a separate route. It is owner
// scoped: the caller must own the AI, and anyone else gets the same 404 as an
// unknown id, the rule every other AI route follows. The gateway hook is
// looked up lazily through `getGateway` because this module is built before
// the agent gateway exists (and stays `null` when it is disabled).
import type { TurnStopper } from '../agents/gateway/stop-types';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { getOwnedAi } from './service';

export interface StopTurnDeps {
  db: ServerDatabase;
  /** The live agent gateway, or null when it is disabled. Resolved per request. */
  getGateway: () => TurnStopper | null;
}

export interface StopTurnInput {
  aiId: string;
  userId: string;
  chatJid: string;
}

/** Owner-checked; answers whether a running turn was stopped. */
export async function stopTurn(
  deps: StopTurnDeps,
  input: StopTurnInput,
): Promise<{ stopped: boolean }> {
  const ai = await getOwnedAi(deps.db, input.aiId, input.userId);
  if (ai === null) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  const stopped = deps.getGateway()?.stopTurn(ai.id, input.chatJid) ?? false;
  return { stopped };
}
