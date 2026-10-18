import type { AiSession } from './contracts';
import type { TurnStopper } from './stop-types';
import { pauseFollow } from './topic-follow';

/**
 * Registers the controller for a turn about to start and returns it. A newer
 * turn in the same chat replaces the previous entry (there is at most one turn
 * per chat at a time); `clearTurnAbort` then leaves the newer one alone.
 */
export function registerTurnAbort(session: AiSession, chatJid: string): AbortController {
  const controller = new AbortController();
  session.turnAborts.set(chatJid, controller);
  return controller;
}

/** Drops a turn's controller once it is over; a newer turn's entry is kept. */
export function clearTurnAbort(
  session: AiSession,
  chatJid: string,
  controller: AbortController,
): void {
  if (session.turnAborts.get(chatJid) === controller) {
    session.turnAborts.delete(chatJid);
  }
}

/** The gateway's `stopTurn` hook, backed by the live session map. */
export function createStopTurn(sessions: Map<string, AiSession>): TurnStopper {
  return {
    stopTurn(aiId: string, chatJid: string): boolean {
      pauseFollow(aiId, chatJid);
      const session = sessions.get(aiId);
      if (session === undefined) {
        return false;
      }
      const controller = session.turnAborts.get(chatJid);
      if (controller === undefined) {
        return false;
      }
      controller.abort();
      return true;
    },
  };
}
