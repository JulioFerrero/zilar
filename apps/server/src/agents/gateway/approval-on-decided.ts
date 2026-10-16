// effect-plain: sequences the approvals route's action then the AI's follow-up
// turn over injected promises; imported by app/routes-ai.ts, which must stay
// free of the XMPP core behind agents/gateway/contracts.ts.
import type { ApprovalFollower } from './stop-types';

// T-1709: the approvals route's `onDecided` hook. The action runs first, so
// the follow-up turn sees the result, then the follow-up queues one turn on
// the AI's own queue.
export function createOnDecided(deps: {
  runAction: (approvalId: string) => Promise<void>;
  /** The live gateway's follow-up hook, or null when it carries none. */
  follower: () => ApprovalFollower | null;
}): (approvalId: string) => Promise<void> {
  return async (approvalId) => {
    await deps.runAction(approvalId);
    await deps.follower()?.continueAfterApproval(approvalId);
  };
}
