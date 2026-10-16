// T-1709 (plan §2.2): after a person approves an AI's request, queue a
// follow-up turn on the AI's own DM or room queue, from the person who
// decided, so the AI can continue the task it stopped at. A deny queues
// nothing. The queueing matches the routine runner (T-1647): the item lands
// on the same queue a live turn uses, so it never overlaps one. It carries no
// `scheduled` field — a person approved, so the turn has that person's role.
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import type { ApprovalRow } from '../../db/rows';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import type { AiSession } from './contracts';

export interface ApprovalFollowUpDeps {
  sessions: Map<string, AiSession>;
  sessionIsLive: (session: AiSession) => boolean;
  loadRoomJid: (groupId: string) => Effect.Effect<string | null>;
  loadTopicRoomJid: (topicId: string) => Effect.Effect<string | null>;
  loadOwnerName: (ownerId: string) => Promise<string>;
  domain: string;
  /** Fire-and-forget pumps for the two queues, like the routine runner's. A
   * kick while a turn is already in flight is a no-op: the running pump picks
   * the new item up when it loops. */
  kickDm: (session: AiSession) => void;
  kickRoom: (session: AiSession, roomJid: string) => void;
  loadApproval: (id: string) => Promise<ApprovalRow | null>;
}

export interface ApprovalFollowUp {
  continueAfterApproval: (approvalId: string) => Promise<void>;
}

export function createApprovalFollowUp(deps: ApprovalFollowUpDeps): ApprovalFollowUp {
  async function continueAfterApproval(approvalId: string): Promise<void> {
    try {
      const row = await deps.loadApproval(approvalId);
      // A missing row, a still-open request, a deny, or a decision without a
      // decider never queues a turn. A `consumed` row does: the action ran,
      // and the AI now needs to see its result and carry on.
      if (
        row === null ||
        row.status === 'pending' ||
        row.status === 'denied' ||
        row.decidedBy === null
      ) {
        return;
      }
      const session = deps.sessions.get(row.aiId);
      if (session === undefined || !deps.sessionIsLive(session)) {
        return;
      }
      const fromJid = jidFor(localpartFor(row.decidedBy), deps.domain);
      const body = `Approved: "${row.summary}". Continue the task from where you stopped. Do not repeat what you already said.`;

      if (row.groupId === null) {
        session.pending.push({ id: randomUUID(), body, fromJid });
        deps.kickDm(session);
        return;
      }

      const roomJid =
        row.topicId === null
          ? await Effect.runPromise(deps.loadRoomJid(row.groupId))
          : await Effect.runPromise(deps.loadTopicRoomJid(row.topicId));
      if (roomJid === null || !session.rooms.has(roomJid)) {
        return;
      }
      const fromNick = await deps.loadOwnerName(row.decidedBy);
      const queued = session.roomPending.get(roomJid) ?? [];
      queued.push({
        id: randomUUID(),
        body,
        fromJid,
        fromResolved: true,
        fromNick,
        timestamp: new Date(),
      });
      session.roomPending.set(roomJid, queued);
      deps.kickRoom(session, roomJid);
    } catch {
      // The approvals route's hook logs a throw; a failure here must not leak
      // a row or a user into a log line.
    }
  }

  return { continueAfterApproval };
}
