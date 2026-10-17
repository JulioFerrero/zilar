/**
 * T-1821: a question card keeps its answer across a reload. The answer is not
 * stored on the card: a chip tap sends a normal reply that quotes the question,
 * and the server closes the question on that first reply. A reply is always
 * newer than the question, so loaded history holds both together.
 * T-1826: the reply may quote the origin id its tapper had live, while the
 * reloaded question carries its archive id, so both ids count.
 */
import type { UiMessage } from './types';

/**
 * Whether `message` is an answer to `question`: a reply that quotes it, by its
 * id or its origin id, from someone else.
 */
export function isQuestionAnswer(message: UiMessage, question: UiMessage): boolean {
  const quotedId = message.replyTo?.id;
  const quotesQuestion =
    quotedId === question.id || (question.originId !== undefined && quotedId === question.originId);
  return quotesQuestion && message.senderId !== question.senderId;
}

/**
 * The option an answer picked, when the reply has the chip's shape
 * `@{aiName} {option}`. Any other text returns `undefined`.
 */
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
