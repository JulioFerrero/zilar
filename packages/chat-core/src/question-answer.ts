/**
 * T-1821: a question card keeps its answer across a reload. The answer is not
 * stored on the card: a chip tap sends a normal reply that quotes the question,
 * and the server closes the question on that first reply. A reply is always
 * newer than the question, so loaded history holds both together.
 */
import type { UiMessage } from './types';

/** Whether `message` is an answer to `question`: a reply that quotes it from someone else. */
export function isQuestionAnswer(message: UiMessage, question: UiMessage): boolean {
  return message.replyTo?.id === question.id && message.senderId !== question.senderId;
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
