import type { ChatMessage } from '@galena/xmpp-core';

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// How many DM messages the AI looks back at. MAM returns them oldest first.
export const DM_HISTORY_MESSAGE_LIMIT = 30;

// Character budget for the history portion of the context (the triggering
// message always fits on top). Oldest messages are dropped first.
export const DM_HISTORY_CHAR_BUDGET = 24_000;

export interface DmContextInput {
  aiName: string;
  persona: string;
  ownerName: string;
  /** Today's date, already formatted, e.g. "2026-09-28". */
  today: string;
  /** Bare JID of the AI, to recognise its own turns. */
  aiJid: string;
  /** Bare JID of the owner, to recognise the owner's turns. */
  ownerJid: string;
  /** DM history oldest first, as MAM returns it. */
  history: ChatMessage[];
  /** The owner message that woke the AI. */
  trigger: Pick<ChatMessage, 'id' | 'body'>;
}

export function bareJid(jid: string): string {
  const slash = jid.indexOf('/');
  return (slash < 0 ? jid : jid.slice(0, slash)).toLowerCase();
}

function isNonEmptyText(body: unknown): body is string {
  return typeof body === 'string' && body.trim() !== '';
}

// The fixed prefix: persona, one platform line, today's date. It stays
// identical between turns, so providers can cache it cheaply.
export function buildSystemMessage(input: {
  aiName: string;
  persona: string;
  ownerName: string;
  today: string;
}): string {
  const persona = input.persona.trim();
  const platform =
    `You are ${input.aiName}, an AI in the Galena chat app, talking in a private chat ` +
    `with ${input.ownerName}. Reply in plain text; keep it concise unless asked.`;
  const parts = [
    persona,
    platform,
    `Today is ${input.today}.`,
    'You can change your own persona with update_persona when your owner asks you to change how you behave from now on.',
  ].filter((part) => part !== '');
  return parts.join('\n');
}

// Maps one history item to a turn, or null when it carries no usable text.
// The owner's messages become `user` turns; the AI's own become `assistant`
// turns. Anything else (strangers, other AIs, non-text payloads) is dropped:
// a DM context has only two speakers.
function toTurn(
  message: ChatMessage,
  aiBare: string,
  ownerBare: string,
): { id: string; role: 'user' | 'assistant'; content: string } | null {
  if (!isNonEmptyText(message.body)) {
    return null;
  }
  const from = bareJid(message.fromJid);
  if (from === aiBare || message.outgoing) {
    return { id: message.id, role: 'assistant', content: message.body };
  }
  if (from === ownerBare) {
    return { id: message.id, role: 'user', content: message.body };
  }
  return null;
}

// Drops the oldest turns until the history fits the character budget.
export function capHistoryByChars<T extends { content: string }>(turns: T[], budget: number): T[] {
  let total = turns.reduce((sum, turn) => sum + turn.content.length, 0);
  let start = 0;
  while (start < turns.length && total > budget) {
    total -= turns[start]!.content.length;
    start += 1;
  }
  return turns.slice(start);
}

// Builds the full message list for one DM turn: system, capped history, then
// the triggering message unless it is already the last history item
// (deduplicated by message id).
export function buildDmMessages(input: DmContextInput): ChatCompletionMessage[] {
  const system = buildSystemMessage(input);
  const aiBare = bareJid(input.aiJid);
  const ownerBare = bareJid(input.ownerJid);

  const recent = input.history.slice(-DM_HISTORY_MESSAGE_LIMIT);
  const turns: Array<{ id: string; role: 'user' | 'assistant'; content: string }> = [];
  for (const message of recent) {
    const turn = toTurn(message, aiBare, ownerBare);
    if (turn !== null) {
      turns.push(turn);
    }
  }
  const capped = capHistoryByChars(turns, DM_HISTORY_CHAR_BUDGET);

  const messages: ChatCompletionMessage[] = [{ role: 'system', content: system }];
  for (const turn of capped) {
    messages.push({ role: turn.role, content: turn.content });
  }

  const triggerBody = isNonEmptyText(input.trigger.body) ? input.trigger.body : '';
  const lastId = capped.length > 0 ? capped[capped.length - 1]!.id : undefined;
  if (triggerBody !== '' && input.trigger.id !== lastId) {
    messages.push({ role: 'user', content: triggerBody });
  }
  return messages;
}
