// T-1422: stopping one running turn from the owner's task card. Each running
// turn (a DM or a room) registers an `AbortController` on its session, keyed by
// the client chat id the owner sees: the AI's own JID in a DM, the room JID in
// a group/topic. `stopTurn` looks the session up by the gateway's own AI id and
// aborts that chat's controller. The route does the owner check; this file only
// reaches the sessions the gateway already holds, so it can never aim at a
// chat or an AI the caller did not name.
import type { AiSession } from './contracts';
import type { TurnStopper } from './stop-types';

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
