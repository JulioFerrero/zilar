import { Effect } from 'effect';

// In-process notifier so the agent gateway learns about group AI membership
// changes without polling. The gateway also reconciles periodically as a
// safety net, so a missed event only delays a room join, never loses it.
// Mirrors the AI lifecycle notifier in ais/service.ts.
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

// Calls each listener in turn, synchronously. A listener that throws is
// dropped for this emit and the next one still runs. The Set is walked live
// (sequential forEach), so a listener that unsubscribes mid-emit is simply
// not visited again.
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

// Sibling notifier for per-topic AI membership (T-0109). The gateway treats
// it exactly like a group event: a live session re-syncs its rooms right
// away, so a newly added or removed membership shows up without waiting for
// the next full reconcile. Only topic ids travel on the event.
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
