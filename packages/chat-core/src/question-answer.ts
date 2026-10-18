// The answer is not stored on the card: a chip tap sends a normal reply that quotes the question, and the server closes the question on that first reply.
// The reply may quote the origin id while the reloaded question carries its archive id, so both ids count.
import type { UiMessage } from './types';

// A reply that quotes it, by its id or its origin id, from someone else.
export function isQuestionAnswer(message: UiMessage, question: UiMessage): boolean {
  const quotedId = message.replyTo?.id;
  const quotesQuestion =
    quotedId === question.id || (question.originId !== undefined && quotedId === question.originId);
  return quotesQuestion && message.senderId !== question.senderId;
}

// The reply has the chip's shape `@{aiName} {option}`; any other text returns `undefined`.
export function answeredOption(
  text: string | undefined,
  aiName: string,
  options: readonly string[],
): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  let rest = text.trim();
  const mention = `@${aiName}`;
  if (rest.startsWith(mention)) {
    rest = rest.slice(mention.length).trim();
  }
  const lower = rest.toLowerCase();
  return options.find((option) => option.toLowerCase() === lower);
}
