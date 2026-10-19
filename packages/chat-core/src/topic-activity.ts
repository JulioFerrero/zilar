import type { TopicAiActivity, TopicAiState, UiMessage } from './types';

export interface TopicActivityView {
  active: TopicAiActivity[];
  done: boolean;
  label: string;
}

// Working before waiting before done, so `active` keeps that order.
const STATE_ORDER: Record<TopicAiState, number> = { working: 0, waiting: 1, done: 2 };

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

// `done` is true only when nothing is active and either a person marked the topic done or an AI finished; General never finishes.
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

// `stage` shows only while that card is live (working or no state yet); a newer finished card means there is no current stage.
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

export function personOf(entry: TopicAiActivity) {
  return {
    id: entry.aiId,
    name: entry.name,
    ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
  };
}
