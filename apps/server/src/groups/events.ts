import { Effect } from 'effect';

// In-process notifier so the agent gateway learns about group AI membership
// changes without polling; it also reconciles periodically, so a missed
// event only delays a room join.
export type GroupAiEvent =
  | { type: 'ai-added'; groupId: string; aiId: string }
  | { type: 'ai-removed'; groupId: string; aiId: string };

const groupAiListeners = new Set<(event: GroupAiEvent) => void>();

export function onGroupAi(listener: (event: GroupAiEvent) => void): () => void {
  groupAiListeners.add(listener);
  return () => {
    groupAiListeners.delete(listener);
  };
}

// Calls each listener synchronously; a throw is dropped for this emit and
// the next still runs. The Set is walked live, so a listener that
// unsubscribes mid-emit is not visited again.
function notifyListeners<T>(listeners: Set<(event: T) => void>, event: T): void {
  Effect.runSync(
    Effect.forEach(listeners, (listener) => Effect.try(() => listener(event)).pipe(Effect.ignore), {
      concurrency: 1,
      discard: true,
    }),
  );
}

export function emitGroupAi(event: GroupAiEvent): void {
  // A gateway listener must never break group management.
  notifyListeners(groupAiListeners, event);
}

// Sibling notifier for per-topic AI membership; the gateway treats it like a
// group event, so a live session re-syncs its rooms. Only topic ids travel.
export type TopicAiEvent =
  | { type: 'ai-added'; topicId: string; aiId: string }
  | { type: 'ai-removed'; topicId: string; aiId: string };

const topicAiListeners = new Set<(event: TopicAiEvent) => void>();

export function onTopicAi(listener: (event: TopicAiEvent) => void): () => void {
  topicAiListeners.add(listener);
  return () => {
    topicAiListeners.delete(listener);
  };
}

export function emitTopicAi(event: TopicAiEvent): void {
  // A gateway listener must never break topic management.
  notifyListeners(topicAiListeners, event);
}
