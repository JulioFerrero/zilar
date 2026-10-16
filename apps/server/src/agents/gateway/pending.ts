// T-1647 (plan §2.2): the queue item types and the scheduled-run outcome,
// moved out of `contracts.ts` so that file stays under the 400-line cap. They
// are re-exported from `contracts.ts`, so every existing import keeps working.

// T-1642 (plan §2.2): the outcome a scheduled routine's DM turn reports back
// through its `onOutcome`. The three owner-message outcomes plus the two
// exits a synthetic trigger can hit before a turn starts: `limited` is the
// daily budget gate, `offline` a disconnected AI.
export type ScheduledTurnOutcome = 'replied' | 'failed' | 'stopped' | 'limited' | 'offline';

// T-1647: what `runScheduledTurn` resolves with. Every `ScheduledTurnOutcome`
// plus `not_in_room`: a room routine the AI's session has not joined (or whose
// room no longer exists) never runs a turn.
export type ScheduledRunOutcome = ScheduledTurnOutcome | 'not_in_room';

export interface PendingMessage {
  id: string;
  body: string;
  fromJid: string;
  /** T-1642: a routine's synthetic trigger, never from the network. It counts
   * as the owner's message, gets no read marker, and reports its turn's
   * outcome through `onOutcome` exactly once. */
  scheduled?: {
    routineId: string;
    /** T-1657 (audit G2): called once when the turn that carries this item
     * starts, so the runner's timeout can begin then instead of at enqueue. */
    onStart?: () => void;
    onOutcome: (outcome: ScheduledTurnOutcome) => void;
  };
}

export interface RoomPendingMessage {
  id: string;
  body: string;
  fromJid: string;
  fromResolved: boolean;
  fromNick?: string;
  timestamp: Date;
  /** T-0479: set by a listener wake, never by a mention. */
  wake?: true;
  /** T-0481: set on an AI-to-AI handoff queued by another AI's @mention. */
  handoff?: true;
  /** T-0482: set on the synthetic trigger `delegate` queues on the worker's
   * session; its id is the delegation row to finish when the turn ends. */
  delegationId?: string;
  /** T-1646: a routine's synthetic trigger, never from the network. It is
   * always its own turn, is admitted before the member checks (its owner may
   * not be a room member), and reports its turn's outcome through `onOutcome`
   * exactly once. */
  scheduled?: {
    routineId: string;
    /** T-1657 (audit G2): called once when the turn that carries this item
     * starts, so the runner's timeout can begin then instead of at enqueue. */
    onStart?: () => void;
    onOutcome: (outcome: ScheduledTurnOutcome) => void;
  };
}
