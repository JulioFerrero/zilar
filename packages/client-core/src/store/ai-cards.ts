// Cards only an AI may send (T-2001). Anyone can put an approval, question,
// blocks, routine or progress payload in a message; from a person it is plain
// text, never the interactive card. The ledger mapping drops such a card before
// either app's renderer sees it, and the approval cards check that the server's
// record belongs to the AI that sent the message.
import { isAiJid, jidLocal, type Payload } from '@zilar/protocol';

/** The text a body-less message shows when its card was refused. */
export const UNSUPPORTED_MESSAGE_TEXT = 'Unsupported message';

const AI_ONLY_CARD_TYPES: ReadonlySet<string> = new Set([
  'approval.request',
  'question',
  'blocks',
  'routine',
  'progress',
]);

/** Whether a payload type is a card only an AI may post. */
export function isAiOnlyCardType(type: string): boolean {
  return AI_ONLY_CARD_TYPES.has(type);
}

/** Whether a message from `senderId` may render `payload` as a card. Every
 * other payload type (a sticker, a task) keeps its old rules. */
export function isCardAllowedFrom(payload: { readonly type: string }, senderId: string): boolean {
  return !isAiOnlyCardType(payload.type) || isAiJid(senderId);
}

/** The payload to keep on the message: an AI-only card from anyone but an AI
 * is dropped, so both renderers fall back to the body text. */
export function permittedCard(payload: Payload, senderId: string): Payload | undefined {
  return isCardAllowedFrom(payload, senderId) ? payload : undefined;
}

/** The AI id in a sender JID (`ai-<aiId>@domain`), or undefined for a person. */
export function senderAiId(senderId: string): string | undefined {
  return isAiJid(senderId) ? jidLocal(senderId).slice('ai-'.length) : undefined;
}

/** Whether the server's approval record belongs to the message's AI sender.
 * A real row's `aiId` is the bare id; the mock record and some older rows keep
 * the full JID localpart (`ai-<aiId>`), so both forms match. */
export function approvalSentBy(aiId: string, senderId: string): boolean {
  const sender = senderAiId(senderId);
  if (sender === undefined) {
    return false;
  }
  return (aiId.startsWith('ai-') ? aiId.slice('ai-'.length) : aiId) === sender;
}
