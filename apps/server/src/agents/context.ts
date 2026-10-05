import type { ChatMessage } from '@zilar/xmpp-core';

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

// Canonical form for every JID comparison on the group path: bare and
// lowercase. Room keys, mention matching, the member check and reply mentions
// all run through this one helper, so a mixed-case stanza still matches.
export function normBareJid(jid: string): string {
  return bareJid(jid);
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
    `You are ${input.aiName}, an AI in the Zilar chat app, talking in a private chat ` +
    `with ${input.ownerName}. Reply in plain text; keep it concise unless asked.`;
  return joinPrefix([
    persona,
    platform,
    `Today is ${input.today}.`,
    'You can change your own persona with update_persona when your owner asks you to change how you behave from now on.',
  ]);
}

export interface GroupContextInput {
  aiName: string;
  persona: string;
  /** Display name of the person who mentioned the AI. */
  senderName: string;
  /** Today's date, already formatted, e.g. "2026-09-28". */
  today: string;
  /** Bare JID of the AI, to recognise its own turns. */
  aiJid: string;
  /** Name of the group the topic belongs to. Omitted when unknown. */
  groupName?: string;
  /** Name of the topic the turn runs in. Omitted when unknown. */
  topicName?: string;
  /** Room history oldest first, as MAM returns it. */
  history: ChatMessage[];
  /** The room message that mentioned the AI. */
  trigger: Pick<ChatMessage, 'id' | 'body'>;
}

// The fixed prefix for a group turn: the same persona and date lines as a DM,
// but the platform line says the AI is in a group and replies to the person
// who mentioned it, briefly unless asked. No persona-tool line: persona tools
// are DM-only (only the owner may reshape the AI, and only in the DM).
// T-0109: for a topic turn the platform line names the topic
// ("You are in the topic <name> of the group <group>") for public and
// private topics alike; it never lists the names of other topics.
export function buildGroupSystemMessage(input: {
  aiName: string;
  persona: string;
  senderName: string;
  today: string;
  groupName?: string;
  topicName?: string;
}): string {
  const persona = input.persona.trim();
  const sender = input.senderName.trim() === '' ? 'a member' : input.senderName.trim();
  const topic = input.topicName?.trim() ?? '';
  const group = input.groupName?.trim() ?? '';
  const where =
    topic !== ''
      ? group !== ''
        ? `You are in the topic ${topic} of the group ${group}. `
        : `You are in the topic ${topic}. `
      : '';
  const platform =
    `You are ${input.aiName}, an AI in the Zilar chat app, talking in a group chat. ` +
    `${where}` +
    `${sender} mentioned you: reply to them directly. Reply in plain text; keep it brief unless asked for more.`;
  return joinPrefix([persona, platform, `Today is ${input.today}.`]);
}

function joinPrefix(parts: string[]): string {
  return parts.filter((part) => part !== '').join('\n');
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

// Maps one room history item to a turn, or null when it carries no usable
// text. The AI's own messages become `assistant` turns; everyone else's become
// `user` turns prefixed with the sender's display name, so the model always
// knows who said what. Other AIs' messages stay plain text: there are no
// AI-to-AI turns in M2.
function toGroupTurn(
  message: ChatMessage,
  aiBare: string,
): { id: string; role: 'user' | 'assistant'; content: string } | null {
  if (!isNonEmptyText(message.body)) {
    return null;
  }
  if (bareJid(message.fromJid) === aiBare || message.outgoing) {
    return { id: message.id, role: 'assistant', content: message.body };
  }
  return { id: message.id, role: 'user', content: `${displayNameOf(message)}: ${message.body}` };
}

// The sender's display name: the MUC nick when known, else the bare JID.
export function displayNameOf(message: { fromJid: string; fromNick?: string | undefined }): string {
  const nick = message.fromNick?.trim() ?? '';
  return nick === '' ? bareJid(message.fromJid) : nick;
}

// Builds the full message list for one group turn: system, capped history,
// then the triggering message unless it is already the last history item
// (deduplicated by message id). The trigger always fits on top, like in DMs.
export function buildGroupMessages(input: GroupContextInput): ChatCompletionMessage[] {
  const system = buildGroupSystemMessage(input);
  const aiBare = bareJid(input.aiJid);
  const sender = input.senderName.trim() === '' ? 'a member' : input.senderName.trim();

  const recent = input.history.slice(-DM_HISTORY_MESSAGE_LIMIT);
  const turns: Array<{ id: string; role: 'user' | 'assistant'; content: string }> = [];
  for (const message of recent) {
    const turn = toGroupTurn(message, aiBare);
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
    messages.push({ role: 'user', content: `${sender}: ${triggerBody}` });
  }
  return messages;
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
