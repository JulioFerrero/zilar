// The wake task can run headless where the chat store is not mounted, so the root layout mirrors `activeChatId` here to stay silent for the chat the user already reads.

let activeChatId: string | null = null;

export function setActiveChatId(chatId: string | null): void {
  activeChatId = chatId;
}

export function getActiveChatId(): string | null {
  return activeChatId;
}
