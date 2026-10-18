export type ScheduledTurnOutcome = 'replied' | 'failed' | 'stopped' | 'limited' | 'offline';

export type ScheduledRunOutcome = ScheduledTurnOutcome | 'not_in_room';

export interface PendingMessage {
  id: string;
  body: string;
  fromJid: string;
  synthetic?: true;
  scheduled?: {
    routineId: string;
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
  synthetic?: true;
  wake?: true;
  handoff?: true;
  delegationId?: string;
  scheduled?: {
    routineId: string;
    onStart?: () => void;
    onOutcome: (outcome: ScheduledTurnOutcome) => void;
  };
}
