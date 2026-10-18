import type { ScheduledTurnOutcome } from './contracts';

// The once-only settle for one turn's scheduled items, shared by the DM and
// room queues. A routine's synthetic trigger reports one outcome through
// `onOutcome`; the first outcome wins, whatever the exit.
export interface ScheduledSettleItem {
  id: string;
  scheduled?: { onOutcome: (outcome: ScheduledTurnOutcome) => void };
}

export function settleFor<T extends ScheduledSettleItem>(
  batch: readonly T[],
): (outcome: ScheduledTurnOutcome) => void {
  const scheduled = batch.filter((item) => item.scheduled !== undefined);
  const settled = new Set<string>();
  return (outcome) => {
    for (const item of scheduled) {
      if (item.scheduled === undefined || settled.has(item.id)) {
        continue;
      }
      settled.add(item.id);
      item.scheduled.onOutcome(outcome);
    }
  };
}
