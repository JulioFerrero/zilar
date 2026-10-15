// T-1570: the handoff-roster read split out of `group-turn-body.ts` so no
// agent file exceeds the 400-line cap. A pure move: the code, wording and
// behaviour are unchanged.
import { Effect } from 'effect';
import type { ServerDatabase } from '../../db/client';
import type { AiSession } from './contracts';
import { loadDelegationFlags } from './db';

export interface HandoffTarget {
  aiId: string;
  nick: string;
  jid: string;
}

// T-0481: the other AIs in this room that may receive a handoff. T-0482:
// the same read carries this AI's `canDelegate` and each target's AI id,
// so the delegation tools can list the roster. One database read for the
// turn; a lookup failure just means no targets and no delegation tools,
// and the turn runs unchanged.
export const resolveHandoffRoster = (
  db: ServerDatabase,
  sessions: Map<string, AiSession>,
  session: AiSession,
  roomJid: string,
): Effect.Effect<{ handoffTargets: HandoffTarget[]; canDelegate: boolean }> =>
  Effect.gen(function* () {
    const otherSessions = [...sessions.values()].filter(
      (candidate) => candidate.aiId !== session.aiId && candidate.rooms.has(roomJid),
    );
    let handoffTargets: HandoffTarget[] = [];
    let canDelegate = false;
    if (otherSessions.length > 0) {
      // Best effort: no handoff targets, the turn runs as before.
      yield* Effect.promise(() =>
        loadDelegationFlags(db, [
          session.aiId,
          ...otherSessions.map((candidate) => candidate.aiId),
        ]),
      ).pipe(
        Effect.map((rows) => {
          canDelegate = rows.find((row) => row.id === session.aiId)?.canDelegate ?? false;
          const accepting = new Set(rows.filter((row) => row.accepts).map((row) => row.id));
          handoffTargets = otherSessions.flatMap((candidate) => {
            const subscription = candidate.rooms.get(roomJid);
            if (subscription === undefined || !accepting.has(candidate.aiId)) {
              return [];
            }
            return [{ aiId: candidate.aiId, nick: subscription.nick, jid: candidate.aiJid }];
          });
        }),
        Effect.catchDefect(() => Effect.void),
      );
    }
    return { handoffTargets, canDelegate };
  });
