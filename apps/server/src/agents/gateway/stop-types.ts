// The shape of the gateway's turn-stop hook, in its own import-free module. The
// app and the AI routes need only this type, and the runner typechecks them
// with a tsconfig that cannot resolve `@xmpp/client`, so it must not pull in
// `gateway/contracts.ts` and the XMPP core behind it.
export interface TurnStopper {
  stopTurn: (aiId: string, chatJid: string) => boolean;
}

// The read side of the gateway's in-memory turn state, for the topic AI
// activity read model. Import-free for the same reason as `TurnStopper`.
export interface TurnWatcher {
  /** Ids of the live sessions with a turn in flight in one bare room JID. */
  runningAiIds: (roomJid: string) => string[];
}

// The gateway's approval-follow-up hook. The approvals route queues a follow-up
// turn after a decision; the app only needs the type, not the XMPP core.
export interface ApprovalFollower {
  continueAfterApproval: (approvalId: string) => Promise<void>;
}

// Hand the gateway over as an `ApprovalFollower` only when it carries one, so a
// gateway double without the hook reads as "no follow-up" instead of throwing.
export function approvalFollowerOf(
  gateway: TurnStopper | ApprovalFollower | null,
): ApprovalFollower | null {
  return gateway !== null && 'continueAfterApproval' in gateway ? gateway : null;
}
