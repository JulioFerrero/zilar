// The chat the app currently shows (T-1358). The wake task can run in a
// headless JS context where the chat store is not mounted, so the root layout
// mirrors the store's `activeChatId` here; `onWake` and the foreground
// notification handler read it to stay silent for the one chat the user is
// already reading, and to post for every other wake (killed, backgrounded, or
// a different chat).

let activeChatId: string | null = null;

/** Records the chat the app currently shows, or null when none is open. */
export function setActiveChatId(chatId: string | null): void {
  activeChatId = chatId;
}

/** The chat the app currently shows, or null when none is open or unknown. */
export function getActiveChatId(): string | null {
  return activeChatId;
}
