// T-1422: the shape of the gateway's turn-stop hook, in its own import-free
// module. The app and the AI routes need only this type, and the runner
// typechecks them with a tsconfig that cannot resolve `@xmpp/client` (only
// `@zilar/xmpp-core` carries those declarations), so the type must not pull in
// `gateway/contracts.ts` and the XMPP core behind it.
export interface TurnStopper {
  stopTurn: (aiId: string, chatJid: string) => boolean;
}

// T-1505: the read side of the gateway's in-memory turn state, for the topic
// AI activity read model. Import-free for the same reason as `TurnStopper`: the
// reader only needs the type, not the XMPP core behind the gateway contracts.
export interface TurnWatcher {
  /** Ids of the live sessions with a turn in flight in one bare room JID. */
  runningAiIds: (roomJid: string) => string[];
}

// T-1709: the gateway's approval-follow-up hook. The approvals route queues a
// follow-up turn after a decision so the AI continues its task; the app only
// needs the type, not the XMPP core behind the gateway contracts.
export interface ApprovalFollower {
  continueAfterApproval: (approvalId: string) => Promise<void>;
}

// T-1709: hand the gateway over as an `ApprovalFollower` only when it carries
// one, so a gateway double without the hook reads as "no follow-up" instead of
// throwing. The app's `getGateway` is typed as a `TurnStopper`, so the live
// gateway also carries this hook.
export function approvalFollowerOf(
  gateway: TurnStopper | ApprovalFollower | null,
): ApprovalFollower | null {
  return gateway !== null && 'continueAfterApproval' in gateway ? gateway : null;
}
