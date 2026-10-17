import type { TopicAiActivity, TopicAiState, UiMessage } from './types';

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
 * General is the group's room and never finishes (T-1843), so there `done` stays
 * false and the label is empty even after an AI replies.
 */
export function topicActivityView(
  activity: readonly TopicAiActivity[],
  doneAt: string | null,
  isGeneral = false,
): TopicActivityView {
  const active = activity
    .filter((entry) => entry.state === 'working' || entry.state === 'waiting')
    .sort((left, right) => STATE_ORDER[left.state] - STATE_ORDER[right.state]);
  const done =
    !isGeneral &&
    active.length === 0 &&
    (doneAt !== null || activity.some((entry) => entry.state === 'done'));
  const label =
    active.length > 0
      ? active.map((entry) => `${entry.name} ${topicActivityLine(entry.state)}`).join(', ')
      : done
        ? 'Done'
        : '';
  return { active, done, label };
}

/**
 * T-1551 (moved from web's `AiStatusLine`, T-1537): the newest progress card of
 * one AI in the chat. Its `stage` shows only while that card is live (`working`
 * or no state yet); a newer finished card means the AI has no current stage, so
 * the status line falls back to "is working".
 */
export function liveStageFor(
  messages: readonly UiMessage[] | undefined,
  jid: string | undefined,
): string | undefined {
  if (messages === undefined || jid === undefined) {
    return undefined;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const card = messages[index]?.card;
    if (card === undefined || card.type !== 'progress' || card.data.ai !== jid) {
      continue;
    }
    return card.data.state === undefined || card.data.state === 'working'
      ? card.data.stage
      : undefined;
  }
  return undefined;
}
