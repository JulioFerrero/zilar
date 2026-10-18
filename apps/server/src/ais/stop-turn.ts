// effect-plain: the Promise edge over the owner-scoped AI read and the
// gateway's synchronous `stopTurn`, like the other AI route helpers.
// Aborts the turn running in one chat. Owner-scoped: anyone else gets the same
// 404 as an unknown id. `getGateway` is lazy because this module is built first.
import type { TurnStopper } from '../agents/gateway/stop-types';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { getOwnedAi } from './service';

export interface StopTurnDeps {
  db: ServerDatabase;
  getGateway: () => TurnStopper | null;
}

export interface StopTurnInput {
  aiId: string;
  userId: string;
  chatJid: string;
}

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
