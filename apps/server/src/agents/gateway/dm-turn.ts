import type { ChatMessage } from '@zilar/xmpp-core';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DraftHub } from '../../drafts/hub';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import { modelNameForAi } from '../../ai/model-entry';
import { ensureAiModel, type AiServiceDeps } from '../../ais/service';
import type { KeyCipher } from '../../connections/crypto';
import { llmVirtualKeys } from '../../db/schema';
import {
  bareJid,
  buildDmMessages,
  DM_HISTORY_MESSAGE_LIMIT,
  type ChatCompletionMessage,
} from '../context';
import { mapFailureToReply, runDmTurn, type ExecuteToolCall } from '../reply';
import { buildTools } from '../tools';
import type { createBudgetGate } from './budget';
import {
  isAiSender,
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type PendingMessage,
} from './contracts';
import { loadActiveAi, loadOwnerName } from './db';
import type { createLiveSession } from './live';
import type { MemoryRunner } from './memory';

type LiveSession = ReturnType<typeof createLiveSession>;

// T-0540 (plan §3, G7): the DM turn extracted from `createAgentGateway`. The
// factory takes the shared live session, budget gate, memory runner and the
// gateway callbacks the moved code closes over, and returns the same
// `pumpSession` the gateway calls. A pure move: no logic or wording changed.
interface DmTurnContext {
  deps: AgentGatewayDeps;
  logger: GatewayLogger;
  turnLogger: GatewayLogger;
  baseUrl: string;
  sessionIsLive: LiveSession['sessionIsLive'];
  liveSendMessage: LiveSession['liveSendMessage'];
  liveSendTyping: LiveSession['liveSendTyping'];
  liveMarkDisplayed: LiveSession['liveMarkDisplayed'];
  liveProgressReporter: LiveSession['liveProgressReporter'];
  budgetGate: ReturnType<typeof createBudgetGate>;
  loadMemoryContext: MemoryRunner['loadMemoryContext'];
  startCompaction: MemoryRunner['startCompaction'];
  disconnectAi: (aiId: string) => Promise<void>;
  secretsFor: (virtualKey?: string) => string[];
  aiDeps: () => AiServiceDeps;
  executeToolCall: (session: AiSession, chatKey: string) => ExecuteToolCall;
  withToolGuide: (messages: ChatCompletionMessage[]) => ChatCompletionMessage[];
  draftHub: DraftHub;
}

export function createDmTurn(ctx: DmTurnContext) {
  const {
    deps,
    logger,
    turnLogger,
    baseUrl,
    sessionIsLive,
    liveSendMessage,
    liveSendTyping,
    liveMarkDisplayed,
    liveProgressReporter,
    budgetGate,
    loadMemoryContext,
    startCompaction,
    disconnectAi,
    secretsFor,
    aiDeps,
    executeToolCall,
    withToolGuide,
    draftHub,
  } = ctx;

  // One turn at a time per AI. Messages arriving during a turn are coalesced:
  // when the turn ends, one more turn runs if new owner messages came in.
  async function pumpSession(session: AiSession): Promise<void> {
    if (session.busy) {
      return;
    }
    session.busy = true;
    try {
      while (session.pending.length > 0 && !session.stopped) {
        const batch = session.pending.splice(0, session.pending.length);
        await runSessionTurn(session, batch);
      }
    } finally {
      session.busy = false;
    }
  }

  async function runSessionTurn(session: AiSession, batch: PendingMessage[]): Promise<void> {
    // The owner JID comes from the database, never from the message. The AI
    // id below is the gateway's own: it keyed this session, so `ensureAiModel`
    // can never be aimed at an id taken from message content.
    const ai = await loadActiveAi(deps.db, session.aiId).catch(() => null);
    if (ai === null) {
      await disconnectAi(session.aiId).catch(() => undefined);
      return;
    }
    const ownerJid = jidFor(localpartFor(ai.owner), deps.xmpp.domain);
    const ownerBare = bareJid(ownerJid);
    // The owner always wins; other `ai-*` senders get no turn (which rules
    // out AI-to-AI loops) and strangers get none either.
    const ownerMessages: PendingMessage[] = [];
    for (const item of batch) {
      const from = bareJid(item.fromJid);
      if (from === ownerBare) {
        ownerMessages.push(item);
      } else if (isAiSender(from)) {
        // Another AI (or our own reflection): never a turn, never a loop.
      }
      // Anything else is a stranger and is ignored.
    }
    if (ownerMessages.length === 0) {
      // Strangers, other `ai-*` senders (no AI-to-AI loops) and anything else
      // get no turn and no LiteLLM call.
      return;
    }
    const trigger = ownerMessages[ownerMessages.length - 1] as PendingMessage;

    // The owner's ticks turn to read: one XEP-0333 displayed marker per turn
    // for the last owner message of the batch. `trigger.id` is the incoming
    // `ChatMessage.id`, the same id the owner's client stores and matches
    // received markers against (the archive stanza-id when known, else the
    // stanza id). Only owner messages are ever marked: strangers and other
    // AIs returned above, before this point. The `liveMarkDisplayed` wrapper
    // drops the marker when the AI was stopped between the message arriving
    // and the marker going out.
    liveMarkDisplayed(session, ownerJid, 'chat', trigger.id);

    // The soft daily limit holds even when the marker above already went out:
    // a limited AI answers with at most one notice per day, and further
    // messages that day get no reply and no notice. The usage read also
    // decides the 80% warnings, which go out after the reply below.
    const dmChatKey = `dm:${ownerBare}`;
    const dmBudget = await budgetGate.checkDailyLimit({
      aiId: session.aiId,
      chatKey: dmChatKey,
      sendNotice: (text) => liveSendMessage(session, ownerJid, 'chat', text),
    });
    if (dmBudget.limited) {
      return;
    }

    // Each turn streams its drafts to the owner under one turn id. The
    // publisher throttles (150 ms); the complete reply is flushed as a draft
    // right before the final XMPP send (`beforeFinalSend`), so the last
    // `draft` carries the final text; `end` always comes after the final XMPP
    // message below. Typing indicators stay exactly as before, for clients
    // without drafts.
    const turnDrafts = draftHub.publishTurn(ai.owner, ai.jid, randomUUID());
    let virtualKey: string | undefined;
    try {
      await ensureAiModel(aiDeps(), session.aiId);
      const [keyRow] = await deps.db
        .select({ encryptedKey: llmVirtualKeys.encryptedKey })
        .from(llmVirtualKeys)
        .where(eq(llmVirtualKeys.aiId, session.aiId))
        .limit(1);
      if (!keyRow) {
        throw new Error(`AI ${session.aiId} has no virtual key`);
      }
      // Decrypted in memory only; never stored, logged or returned.
      virtualKey = (deps.cipher as KeyCipher).decrypt(keyRow.encryptedKey);

      let history: ChatMessage[] = [];
      try {
        const page = await session.core.loadHistory(ownerJid, 'chat', {
          max: DM_HISTORY_MESSAGE_LIMIT,
        });
        history = page.messages;
      } catch (historyError) {
        logger.warn(
          { err: toRedactedError(historyError, secretsFor(virtualKey)), aiId: session.aiId },
          'AI history lookup failed; replying without history',
        );
      }

      const ownerName = await loadOwnerName(deps.db, ai.owner);
      const now = (deps.now ?? (() => new Date()))();
      const today = now.toISOString().slice(0, 10);
      const memory = await loadMemoryContext({
        aiId: session.aiId,
        chatKey: dmChatKey,
        archiveOwner: ai.localpart,
        scope: { kind: 'dm', peer: ownerBare },
        aiBareJid: bareJid(ai.jid),
        ownerName,
        now,
        virtualKey,
      });
      // The batch is newer than the archive may know: merge the triggering
      // messages into the history (skipping ids MAM already returned) so a
      // coalesced turn sees every message that arrived, and the trigger below
      // deduplicates against the last one by id.
      const knownIds = new Set(history.map((message) => message.id));
      const fresh: ChatMessage[] = ownerMessages
        .filter((item) => !knownIds.has(item.id))
        .map((item) => ({
          id: item.id,
          chatJid: session.aiJid,
          kind: 'chat' as const,
          fromJid: ownerJid,
          fromResolved: true,
          body: item.body,
          timestamp: now,
          outgoing: false,
        }));
      const messages: ChatCompletionMessage[] = buildDmMessages({
        aiName: ai.name,
        persona: ai.persona,
        ownerName,
        today,
        aiJid: ai.jid,
        ownerJid,
        history: [...history, ...fresh],
        trigger,
        memory,
      });
      // T-0106: the guide rides as a trailing user turn only when tools are
      // enabled and tool/routine adapters are registered (a non-empty
      // action list, so `request_action` is actually offered). Otherwise
      // today's messages, byte for byte.
      const dmActionsList = deps.actions?.listActions() ?? [];
      const dmMessages =
        deps.toolsEnabled === true && dmActionsList.length > 0 ? withToolGuide(messages) : messages;

      // `end` always comes after the final XMPP message: `runDmTurn` sends
      // it before resolving. Every send and draft push is gated by a
      // `live*` wrapper so a stop that lands between the LLM call and the
      // final send drops the reply (and every draft) instead of delivering
      // it. The `end` itself runs unconditionally so the owner's client
      // sees the turn terminate instead of hanging.
      // T-0106: multi-round turns post one live progress message at the
      // first tool round and update it per round; it is retracted when the
      // final text lands. Best effort: the turn never fails over it.
      const dmProgress = liveProgressReporter(session, ownerJid, 'chat', ai.jid);
      const outcome = await runDmTurn({
        aiId: session.aiId,
        ownerJid,
        messages: dmMessages,
        baseUrl: baseUrl,
        virtualKey,
        model: modelNameForAi(session.aiId),
        executeTool: executeToolCall(session, dmChatKey),
        tools: buildTools(deps.actions?.listActions() ?? []),
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        ...(deps.toolMaxRounds === undefined ? {} : { maxRounds: deps.toolMaxRounds }),
        checkRoundGate: () => budgetGate.checkDmRoundGate(session),
        reportProgress: dmProgress.reportProgress,
        clearProgress: dmProgress.clearProgress,
        // T-0156: wires the per-turn counts line (ids and counts only,
        // never content) into production — the wire the T-0106 review
        // deferred.
        turnLogger,
        onDelta: (textSoFar) => {
          if (sessionIsLive(session)) {
            turnDrafts.push(textSoFar);
          }
        },
        beforeFinalSend: (text) => {
          if (sessionIsLive(session)) {
            turnDrafts.flush(text);
          }
        },
        sendMessage: (to, kind, text) => liveSendMessage(session, to, kind, text),
        sendTyping: (to, kind, state) => {
          liveSendTyping(session, to, kind, state);
        },
        logger,
        secrets: secretsFor(),
      });
      turnDrafts.end(outcome.kind === 'replied' && sessionIsLive(session) ? 'sent' : 'failed');
      // The 80% heads-ups go out after the reply, so the owner reads the
      // answer first. A failed warning send only logs and never fails the
      // turn.
      await budgetGate.sendBudgetWarnings({
        aiId: session.aiId,
        chatKey: dmChatKey,
        usage: dmBudget.usage,
        sendWarning: (text) => liveSendMessage(session, ownerJid, 'chat', text),
      });
      startCompaction(session, dmChatKey, virtualKey);
    } catch (error) {
      // ensureAiModel, the key lookup and anything else outside the turn: an
      // honest short message, never the raw error.
      logger.warn(
        { err: toRedactedError(error, secretsFor(virtualKey)), aiId: session.aiId },
        'AI turn failed',
      );
      const reply = mapFailureToReply(error);
      try {
        await liveSendMessage(session, ownerJid, 'chat', reply);
      } catch {
        // There is nobody left to tell when the send itself fails.
      }
      // The failed `end` goes out only after the failure text was sent (or
      // its send was attempted): the contract promises `end` comes last.
      try {
        liveSendTyping(session, ownerJid, 'chat', 'paused');
      } catch {
        // Typing state is best-effort.
      }
      turnDrafts.end('failed');
    }
  }

  return { pumpSession };
}
