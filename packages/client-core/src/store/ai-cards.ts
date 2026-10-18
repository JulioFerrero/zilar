// Cards only an AI may send. Anyone can put an approval, question, blocks, routine or
// progress payload in a message; from a person it is plain text, never a card. The approval
// cards check the server's record belongs to the AI that sent the message.
import { isAiJid, jidLocal, type Payload } from '@zilar/protocol';

export const UNSUPPORTED_MESSAGE_TEXT = 'Unsupported message';

const AI_ONLY_CARD_TYPES: ReadonlySet<string> = new Set([
  'approval.request',
  'question',
  'blocks',
  'routine',
  'progress',
]);

export function isAiOnlyCardType(type: string): boolean {
  return AI_ONLY_CARD_TYPES.has(type);
}

export function isCardAllowedFrom(payload: { readonly type: string }, senderId: string): boolean {
  return !isAiOnlyCardType(payload.type) || isAiJid(senderId);
}

/** The payload to keep: an AI-only card from anyone but an AI is dropped, so both
 * renderers fall back to the body text. */
export function permittedCard(payload: Payload, senderId: string): Payload | undefined {
  return isCardAllowedFrom(payload, senderId) ? payload : undefined;
}

export function senderAiId(senderId: string): string | undefined {
  return isAiJid(senderId) ? jidLocal(senderId).slice('ai-'.length) : undefined;
}

/** Whether the server's approval record belongs to the message's AI sender. A real row's
 * `aiId` is bare; some older rows keep the full JID localpart, so both forms match. */
export function approvalSentBy(aiId: string, senderId: string): boolean {
  const sender = senderAiId(senderId);
  if (sender === undefined) {
    return false;
  }
  return (aiId.startsWith('ai-') ? aiId.slice('ai-'.length) : aiId) === sender;
}
