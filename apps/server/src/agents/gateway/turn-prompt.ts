// effect-plain: prompt assembly stays Promise-shaped under the Effect-side callers.
import type { ChatMessage } from '@zilar/xmpp-core';
import {
  bareJid,
  buildDmMessages,
  buildGroupMessages,
  type ChatCompletionMessage,
} from '../context';
import { promptNow } from '../prompt-time';
import { timeZoneFor, timeZoneForJid } from '../../auth/profile-time-zone';
import { senderNamesByJid } from '../../xmpp/archive-sender';
import type { ModelTarget } from '../../ai/providers';
import { toRedactedError, type AiSession } from './contracts';
import { loadOwnerName } from './db';
import type { DmTurnContext } from './dm-turn';

type PromptItem = Required<Pick<ChatMessage, 'id' | 'body' | 'fromJid'>> &
  Partial<Pick<ChatMessage, 'fromResolved' | 'fromNick' | 'timestamp'>>;

export interface TurnPromptInput {
  ctx: Pick<DmTurnContext, 'deps' | 'logger' | 'loadMemoryContext' | 'secretsFor'>;
  ai: { name: string; persona: string; jid: string; localpart: string; owner: string };
  session: AiSession;
  target: ModelTarget;
  /** The owner's DM JID, or the room JID; `kind` picks the turn path. */
  chat: { kind: 'dm' | 'group'; jid: string; key: string; limit: number };
  items: readonly PromptItem[];
  trigger: Pick<ChatMessage, 'id' | 'body' | 'fromJid'>;
  senderName?: string | undefined;
  groupName?: string | undefined;
  topicName?: string | undefined;
  handoffNames?: string[] | undefined;
}

export async function loadTurnPrompt(input: TurnPromptInput): Promise<ChatCompletionMessage[]> {
  const dm = input.chat.kind === 'dm';
  const chatKind = dm ? 'chat' : 'groupchat';
  let history: ChatMessage[];
  try {
    history = (
      await input.session.core.loadHistory(input.chat.jid, chatKind, { max: input.chat.limit })
    ).messages;
  } catch (historyError) {
    input.ctx.logger.warn(
      {
        err: toRedactedError(historyError, input.ctx.secretsFor(input.target.apiKey)),
        aiId: input.session.aiId,
      },
      dm
        ? 'AI history lookup failed; replying without history'
        : 'AI group history lookup failed; replying without history',
    );
    history = [];
  }
  const name = dm
    ? await loadOwnerName(input.ctx.deps.db, input.ai.owner)
    : (input.senderName ?? '');
  const now = (input.ctx.deps.now ?? (() => new Date()))();
  const zone = dm
    ? await timeZoneFor(input.ctx.deps.db, input.ai.owner)
    : await timeZoneForJid(input.ctx.deps.db, bareJid(input.trigger.fromJid));
  const memory = await input.ctx.loadMemoryContext({
    aiId: input.session.aiId,
    chatKey: input.chat.key,
    archiveOwner: dm ? input.ai.localpart : input.chat.jid,
    scope: dm
      ? { kind: 'dm', peer: bareJid(input.chat.jid) }
      : { kind: 'room', room: input.chat.jid },
    aiBareJid: bareJid(input.ai.jid),
    now,
    ...(dm ? { ownerName: name } : {}),
    secret: input.target.apiKey,
  });
  // The batch is newer than the archive may know: merge its messages into the
  // history, skipping ids MAM already returned, so a coalesced turn sees every
  // message that arrived.
  const knownIds = new Set(history.map((message) => message.id));
  const fresh: ChatMessage[] = input.items
    .filter((item) => !knownIds.has(item.id))
    .map((item) => ({
      id: item.id,
      chatJid: dm ? input.session.aiJid : input.chat.jid,
      kind: chatKind,
      fromJid: dm ? input.chat.jid : item.fromJid,
      fromResolved: dm ? true : item.fromResolved === true,
      ...(item.fromNick === undefined ? {} : { fromNick: item.fromNick }),
      body: item.body,
      timestamp: item.timestamp ?? now,
      outgoing: false,
    }));
  const merged = [...history, ...fresh];
  if (dm) {
    return buildDmMessages({
      aiName: input.ai.name,
      persona: input.ai.persona,
      ownerName: name,
      today: promptNow(now, zone),
      aiJid: input.ai.jid,
      ownerJid: input.chat.jid,
      history: merged,
      trigger: input.trigger,
      memory,
    });
  }
  const senderNames = await senderNamesByJid(
    input.ctx.deps.db,
    merged.flatMap((message) => (message.fromResolved ? [message.fromJid] : [])),
  ).catch(() => new Map<string, string>());
  return buildGroupMessages({
    aiName: input.ai.name,
    persona: input.ai.persona,
    senderName: name,
    today: promptNow(now, zone),
    aiJid: input.ai.jid,
    senderNames,
    ...(input.groupName === undefined ? {} : { groupName: input.groupName }),
    ...(input.topicName === undefined ? {} : { topicName: input.topicName }),
    ...(input.handoffNames === undefined ? {} : { handoffNames: input.handoffNames }),
    history: merged,
    trigger: input.trigger,
    memory,
  });
}
