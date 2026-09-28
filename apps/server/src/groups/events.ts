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

export function emitGroupAi(event: GroupAiEvent): void {
  // Deleting from a Set while iterating it is safe: a listener that
  // unsubscribes mid-emit is simply not visited again.
  for (const listener of groupAiListeners) {
    try {
      listener(event);
    } catch {
      // A gateway listener must never break group management.
    }
  }
}
