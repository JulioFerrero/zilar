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
  // Decide per turn, from the database, whether the trigger's sender may ask
  // the AI for an action. Any human member who can see the topic qualifies:
  // `memberRolesByJid` holds human members only, so an AI sender, an unknown
  // occupant or an AI handoff has no role and never qualifies. Every room turn
  // still carries the three memory tools, so the tool loop always runs.
  // A scheduled routine's creator was checked at approval, so its trigger may
  // ask for an action; the run is marked unattended, so `request_action` stays
  // on for tier 0/1 while `ask_people` and delegation stay off.
  const scheduledTrigger = trigger.scheduled !== undefined;
  const triggerBare = normBareJid(trigger.fromJid);
  const triggerRole = gate.memberRolesByJid.get(triggerBare);
  const allowedForAction =
    scheduledTrigger || (triggerRole !== undefined && trigger.handoff !== true);
  const allowActions = allowedForAction && actionsList.length > 0;
  // The AI's computer is used only when the AI's owner, or a room owner or
  // admin, triggers the turn. A scheduled routine counts too, because its
  // creator was checked at approval. A plain member's approval-free action
  // request still must not reach it.
  const allowDesk =
    scheduledTrigger ||
    triggerRole === 'owner' ||
    triggerRole === 'admin' ||
    triggerBare === aiOwnerBare;
  // `ask_people` is offered only when a person triggered the turn. An
  // AI-to-AI handoff, a `delegate`-queued trigger or a scheduled routine never
  // gets the question tool.
  const askPeople = !scheduledTrigger && trigger.handoff !== true;
  // Offer the delegation tools only when this AI may delegate and at least one
  // accepting AI is in the room. The target list is each accepting session's id
  // and room nick.
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

// The re-check callback runs at tool-execution time. Any human member may ask,
// so it requires only that the sender is still a member of this topic; a
// membership removed between the mention and the tool call short-circuits to
// `denied: not allowed` without invoking the action gateway.
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
          // The sender must still be a member of this topic. A member
          // removed mid-turn, or an unknown sender, is denied.
          return fresh.memberJids.has(triggerBare);
        }),
      ),
    );
}
