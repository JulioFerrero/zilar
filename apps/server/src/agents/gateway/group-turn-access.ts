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
  // T-0098/T-0444: decide per turn, from the database, whether the
  // trigger's sender is allowed to ask the AI for an action. The role
  // lives on the `roomGate` we already loaded; a plain `member`, an AI
  // sender or an unknown occupant does not get `request_action`. Every
  // room turn still carries the three memory tools (T-0444), so the tool
  // loop always runs.
  // T-1646/T-1655: a scheduled routine's creator was checked when the
  // routine was approved, so a scheduled trigger is allowed to ask for an
  // action. The run is marked unattended, so `request_action` stays on for
  // tier 0/1 while `ask_people` and delegation stay off (plan §2.5).
  const scheduledTrigger = trigger.scheduled !== undefined;
  const triggerBare = normBareJid(trigger.fromJid);
  const triggerRole = gate.memberRolesByJid.get(triggerBare);
  const allowedForAction = scheduledTrigger || triggerRole === 'owner' || triggerRole === 'admin';
  const allowActions = allowedForAction && actionsList.length > 0;
  // SEC-13b (Julio chose (a), 2026-10-16): the AI's computer is used only
  // when the AI's owner, or a room owner or admin, triggers the turn. A
  // scheduled routine counts too, because its creator was checked when the
  // routine was approved (T-1646/T-1655), the same rule actions use.
  const allowDesk = allowedForAction || triggerBare === aiOwnerBare;
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

// The re-check callback runs at tool-execution time. A `plain
// member` turn never offers `request_action`, so this never fires for
// them; for an admin/owner turn it queries the same gate so a
// demotion that landed between the mention and the tool call
// short-circuits to `denied: not allowed` without invoking the
// action gateway.
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
          const role = fresh.memberRolesByJid.get(triggerBare);
          // T-0109: the sender must still be a group owner/admin AND a member
          // of this topic. Either check failing denies the action.
          return (role === 'owner' || role === 'admin') && fresh.memberJids.has(triggerBare);
        }),
      ),
    );
}
