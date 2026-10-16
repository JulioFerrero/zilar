// T-1661: the room turn's per-turn access rules split out of
// `group-turn-body.ts` so no agent file exceeds the 400-line cap. A pure
// move: the code, wording and behaviour are unchanged.
import { Effect } from 'effect';
import type { ServerDatabase } from '../../db/client';
import { normBareJid } from '../context';
import type { RoomPendingMessage, RoomSubscription } from './contracts';
import { loadRoomGateState, type RoomGateState } from './db';
import type { HandoffTarget } from './group-turn-roster';

export interface GroupTurnAccessInput {
  trigger: RoomPendingMessage;
  gate: RoomGateState;
  actionsList: ReadonlyArray<{ name: string; description: string; argsExample?: string }>;
  canDelegate: boolean;
  handoffTargets: HandoffTarget[];
  /** SEC-13b: the AI owner's bare JID, so a turn they trigger may use the
   * AI's computer even when they are only a plain room member. */
  aiOwnerBare: string;
}

export interface GroupTurnAccess {
  scheduledTrigger: boolean;
  triggerBare: string;
  allowedForAction: boolean;
  allowActions: boolean;
  allowDesk: boolean;
  askPeople: boolean;
  delegateTargets: { id: string; name: string }[] | undefined;
}

export function groupTurnAccess(input: GroupTurnAccessInput): GroupTurnAccess {
  const { trigger, gate, actionsList, canDelegate, handoffTargets, aiOwnerBare } = input;
  // T-1727 (Julio, 2026-10-16, "Members can ask"): decide per turn, from the
  // database, whether the trigger's sender may ask the AI for an action. Any
  // human member who can see the topic qualifies: `memberRolesByJid` holds
  // human members only, so an AI sender or an unknown occupant has no role
  // and never qualifies. An AI handoff is another AI's turn, not a person's,
  // so it does not either. Every room turn still carries the three memory
  // tools (T-0444), so the tool loop always runs.
  // T-1646/T-1655: a scheduled routine's creator was checked when the
  // routine was approved, so a scheduled trigger is allowed to ask for an
  // action. The run is marked unattended, so `request_action` stays on for
  // tier 0/1 while `ask_people` and delegation stay off (plan §2.5).
  const scheduledTrigger = trigger.scheduled !== undefined;
  const triggerBare = normBareJid(trigger.fromJid);
  const triggerRole = gate.memberRolesByJid.get(triggerBare);
  const allowedForAction =
    scheduledTrigger || (triggerRole !== undefined && trigger.handoff !== true);
  const allowActions = allowedForAction && actionsList.length > 0;
  // SEC-13b (Julio chose (a), 2026-10-16): the AI's computer is used only
  // when the AI's owner, or a room owner or admin, triggers the turn. A
  // scheduled routine counts too, because its creator was checked when the
  // routine was approved (T-1646/T-1655). A plain member's approval-free
  // action request (T-1727) still must not reach it.
  const allowDesk =
    scheduledTrigger ||
    triggerRole === 'owner' ||
    triggerRole === 'admin' ||
    triggerBare === aiOwnerBare;
  // T-1576: `ask_people` is offered only when a person triggered the turn. An
  // AI-to-AI handoff, a `delegate`-queued trigger or a scheduled routine is
  // not the people in the room, so those turns never get the question tool.
  const askPeople = !scheduledTrigger && trigger.handoff !== true;
  // T-0482: offer the delegation tools only when this AI may delegate and
  // at least one accepting AI is in the room. The target list is the id
  // and room nick of each accepting session.
  const delegateTargets =
    !scheduledTrigger && canDelegate && handoffTargets.length > 0
      ? handoffTargets.map((target) => ({ id: target.aiId, name: target.nick }))
      : undefined;
  return {
    scheduledTrigger,
    triggerBare,
    allowedForAction,
    allowActions,
    allowDesk,
    askPeople,
    delegateTargets,
  };
}

// The re-check callback runs at tool-execution time. T-1727: any human
// member may ask, so it now queries the same gate and requires only that the
// sender is still a member of this topic; a membership removed between the
// mention and the tool call short-circuits to `denied: not allowed` without
// invoking the action gateway. An AI or handoff sender never received
// `request_action`, so it never reaches this path.
export function makeIsStillAllowed(
  db: ServerDatabase,
  domain: string,
  room: RoomSubscription,
  triggerBare: string,
): () => Promise<boolean> {
  return (): Promise<boolean> =>
    Effect.runPromise(
      Effect.promise(() => loadRoomGateState(db, room.groupId, domain, room.topicId)).pipe(
        Effect.map((fresh) => {
          if (fresh === null) {
            return false;
          }
          // T-1727: the sender must still be a member of this topic. A member
          // removed mid-turn, or an unknown sender, is denied.
          return fresh.memberJids.has(triggerBare);
        }),
      ),
    );
}
