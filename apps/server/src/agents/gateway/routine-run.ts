// T-1647 (plan §2.2): the routine scheduler's port into the gateway. A
// scheduled run queues a routine's synthetic trigger on the AI's own DM or
// room queue — the same queue a live turn uses, so it never overlaps one — and
// resolves with the turn's outcome. It is never reached from the network: only
// the scheduler calls it.
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import type { AiSession, ScheduledRunOutcome, ScheduledTurnOutcome } from './contracts';

// A turn that never settles resolves `'failed'` after this. A computer turn is
// capped at 15 minutes (T-1611), so 20 minutes leaves room for the model calls
// and tools around it.
export const ROUTINE_TIMEOUT_MS = 20 * 60 * 1000;

export interface ScheduledTurnInput {
  aiId: string;
  /** `null` for a DM routine; the group id for a room routine. */
  groupId: string | null;
  /** The topic to post into; `null` means the group's General room. */
  topicId: string | null;
  routineId: string;
  title: string;
  prompt: string;
}

export interface RoutineRunnerDeps {
  sessions: Map<string, AiSession>;
  sessionIsLive: (session: AiSession) => boolean;
  loadOwnerId: (aiId: string) => Effect.Effect<string | null>;
  loadTopicRoomJid: (topicId: string) => Effect.Effect<string | null>;
  loadRoomJid: (groupId: string) => Effect.Effect<string | null>;
  loadOwnerName: (ownerId: string) => Promise<string>;
  domain: string;
  /** Fire-and-forget pumps for the two queues, like the ones the network path
   * uses. A kick while a turn is already in flight is a no-op: the running
   * pump picks the new item up when it loops. */
  kickDm: (session: AiSession) => void;
  kickRoom: (session: AiSession, roomJid: string) => void;
  timeoutMs?: number;
}

export interface RoutineRunner {
  runScheduledTurn: (input: ScheduledTurnInput) => Promise<ScheduledRunOutcome>;
}

export function createRoutineRunner(deps: RoutineRunnerDeps): RoutineRunner {
  const timeoutMs = deps.timeoutMs ?? ROUTINE_TIMEOUT_MS;

  async function runScheduledTurn(input: ScheduledTurnInput): Promise<ScheduledRunOutcome> {
    const session = deps.sessions.get(input.aiId);
    if (session === undefined || !deps.sessionIsLive(session)) {
      return 'offline';
    }
    const ownerId = await Effect.runPromise(deps.loadOwnerId(input.aiId)).catch(() => null);
    if (ownerId === null) {
      return 'offline';
    }
    const ownerJid = jidFor(localpartFor(ownerId), deps.domain);
    const body = `Scheduled run "${input.title}".\n${input.prompt}`;

    // The first outcome the turn reports wins, whatever the exit; a turn that
    // never settles is reported `failed` by the timer. The timer is cleared in
    // the `finally`, so a settled run leaves no dangling timer behind.
    let settled = false;
    let resolveOutcome!: (outcome: ScheduledRunOutcome) => void;
    const outcome = new Promise<ScheduledRunOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    const settle = (value: ScheduledTurnOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolveOutcome(value);
    };
    const timer = setTimeout(() => settle('failed'), timeoutMs);
    try {
      if (input.groupId === null) {
        session.pending.push({
          id: randomUUID(),
          body,
          fromJid: ownerJid,
          scheduled: { routineId: input.routineId, onOutcome: settle },
        });
        deps.kickDm(session);
      } else {
        const roomJid =
          input.topicId === null
            ? await Effect.runPromise(deps.loadRoomJid(input.groupId))
            : await Effect.runPromise(deps.loadTopicRoomJid(input.topicId));
        if (roomJid === null || !session.rooms.has(roomJid)) {
          return 'not_in_room';
        }
        const ownerName = await deps.loadOwnerName(ownerId);
        const queued = session.roomPending.get(roomJid) ?? [];
        queued.push({
          id: randomUUID(),
          body,
          fromJid: ownerJid,
          fromResolved: true,
          fromNick: ownerName,
          timestamp: new Date(),
          scheduled: { routineId: input.routineId, onOutcome: settle },
        });
        session.roomPending.set(roomJid, queued);
        deps.kickRoom(session, roomJid);
      }
      return await outcome;
    } finally {
      clearTimeout(timer);
    }
  }

  return { runScheduledTurn };
}
