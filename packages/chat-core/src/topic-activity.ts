import type { TopicAiActivity, TopicAiState } from './types';

/** What a topic's AI activity reads as, for the list row and the "AIs here" key. */
export interface TopicActivityView {
  /** The AIs still at work: working first, then waiting. Empty when none. */
  active: TopicAiActivity[];
  /** True when nothing is active and the topic reads as finished. */
  done: boolean;
  /** One sentence for the group's accessible name, e.g. "Dev-1 is working, QA-1 is waiting for you", "Done", or "". */
  label: string;
}

/** Working before waiting before done, so `active` keeps that order. */
const STATE_ORDER: Record<TopicAiState, number> = { working: 0, waiting: 1, done: 2 };

/** The one line an AI's state reads as in the "AIs here" key. */
export function topicActivityLine(state: TopicAiState): string {
  switch (state) {
    case 'working':
      return 'is working';
    case 'waiting':
      return 'is waiting for you';
    case 'done':
      return 'is done';
  }
}

/**
 * Sorts a topic's AI activity and labels it (T-1532). `active` holds the AIs
 * still at work, working first, then waiting; `done` is true only when nothing
 * is active and either a person marked the topic done (`doneAt`) or an AI
 * finished. An idle topic reads as `{ active: [], done: false, label: '' }`.
 */
export function topicActivityView(
  activity: readonly TopicAiActivity[],
  doneAt: string | null,
): TopicActivityView {
  const active = activity
    .filter((entry) => entry.state === 'working' || entry.state === 'waiting')
    .sort((left, right) => STATE_ORDER[left.state] - STATE_ORDER[right.state]);
  const done =
    active.length === 0 && (doneAt !== null || activity.some((entry) => entry.state === 'done'));
  const label =
    active.length > 0
      ? active.map((entry) => `${entry.name} ${topicActivityLine(entry.state)}`).join(', ')
      : done
        ? 'Done'
        : '';
  return { active, done, label };
}
