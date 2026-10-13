// T-1290 review: the group turn's model/reply body, split out of
// `group-turn.ts` so no agent file exceeds the 400-line cap. A pure move:
// the code, wording and behaviour are unchanged.
import { Effect } from 'effect';
import type { ChatMessage } from '@zilar/xmpp-core';
import { modelNameForAi } from '../../ai/model-entry';
import { ensureAiModel, type ActiveAiForGateway } from '../../ais/service';
import type { AiUsage } from '../../ais/usage';
import type { KeyCipher } from '../../connections/crypto';
import {
  buildGroupMessages,
  DM_HISTORY_MESSAGE_LIMIT,
  normBareJid,
  type ChatCompletionMessage,
} from '../context';
import { finishDelegation } from '../delegation/service';
import { runGroupTurn } from '../reply';
import { buildGroupTools } from '../tools';
import {
  errorName,
  rememberRoomSentId,
  toRedactedError,
  type AiSession,
  type RoomPendingMessage,
  type RoomSubscription,
} from './contracts';
import {
  loadDelegationFlags,
  loadEncryptedVirtualKey,
  loadRoomGateState,
  type RoomGateState,
} from './db';
import type { GroupTurnContext } from './group-turn';

export interface GroupTurnBodyInput {
  ctx: GroupTurnContext;
  ai: ActiveAiForGateway;
  session: AiSession;
  roomJid: string;
  room: RoomSubscription;
  gate: RoomGateState;
  groupChatKey: string;
  groupBudget: { limited: boolean; usage: AiUsage | null };
  eligible: RoomPendingMessage[];
  trigger: RoomPendingMessage;
  senderName: string;
  groupName: string | undefined;
  topicName: string | undefined;
  /** T-1290: filled with the decrypted key so the caller's failure path can
   * redact it from the log line without holding the key itself. */
  virtualKeyRef: { value?: string };
}

// T-1290 (AI-10): the room hears the fixed `GROUP_FAILURE_REPLY`; the owner
// hears the real reason by DM, at most once a day per room. The budget gate
// owns the day key (the `dailyLimitNotices` pattern) and the owner lookup.
export function notifyOwnerOfFailure(
  ctx: GroupTurnContext,
  session: AiSession,
  roomJid: string,
  reason: string,
): Promise<void> {
  return ctx.budgetGate.notifyOwnerOfFailure({
    aiId: session.aiId,
    roomJid,
    reason,
    send: (to, text) => ctx.liveSendMessage(session, to, 'chat', text),
  });
}

export function runGroupTurnBody(input: GroupTurnBodyInput): Effect.Effect<void> {
  const {
    ctx,
    ai,
    session,
    roomJid,
    room,
    gate,
    groupChatKey,
    groupBudget,
    eligible,
    trigger,
    senderName,
    groupName,
    topicName,
    virtualKeyRef,
  } = input;
  const {
    deps,
    logger,
    turnLogger,
    baseUrl,
    sessions,
    liveSendMessage,
    liveSendTyping,
    liveProgressReporter,
    budgetGate,
    loadMemoryContext,
    startCompaction,
    secretsFor,
    aiDeps,
    executeToolCall,
    withToolGuide,
  } = ctx;

  return Effect.gen(function* () {
    yield* Effect.promise(() => ensureAiModel(aiDeps(), session.aiId));
    const encryptedKey = yield* Effect.promise(() =>
      loadEncryptedVirtualKey(deps.db, session.aiId),
    );
    if (encryptedKey === null) {
      throw new Error(`AI ${session.aiId} has no virtual key`);
    }
    // Decrypted in memory only; never stored, logged or returned.
    const key = (deps.cipher as KeyCipher).decrypt(encryptedKey);
    virtualKeyRef.value = key;

    const history = yield* Effect.promise(() =>
      session.core.loadHistory(roomJid, 'groupchat', {
        max: DM_HISTORY_MESSAGE_LIMIT,
      }),
    ).pipe(
      Effect.map((page): ChatMessage[] => page.messages),
      Effect.catchDefect((historyError) =>
        Effect.sync((): ChatMessage[] => {
          logger.warn(
            { err: toRedactedError(historyError, secretsFor(key)), aiId: session.aiId },
            'AI group history lookup failed; replying without history',
          );
          return [];
        }),
      ),
    );

    const now = (deps.now ?? (() => new Date()))();
    const today = now.toISOString().slice(0, 10);
    const memory = yield* Effect.promise(() =>
      loadMemoryContext({
        aiId: session.aiId,
        chatKey: groupChatKey,
        archiveOwner: roomJid,
        scope: { kind: 'room', room: roomJid },
        aiBareJid: normBareJid(ai.jid),
        now,
        virtualKey: key,
      }),
    );
    // The batch is newer than the archive may know: merge the eligible
    // messages into the history (skipping ids MAM already returned) so a
    // coalesced turn sees every mention that arrived, and the context
    // builder below deduplicates the trigger by id.
    const knownIds = new Set(history.map((message) => message.id));
    const fresh: ChatMessage[] = eligible
      .filter((item) => !knownIds.has(item.id))
      .map((item) => ({
        id: item.id,
        chatJid: roomJid,
        kind: 'groupchat' as const,
        fromJid: item.fromJid,
        fromResolved: item.fromResolved,
        ...(item.fromNick === undefined ? {} : { fromNick: item.fromNick }),
        body: item.body,
        timestamp: item.timestamp,
        outgoing: false,
      }));
    // T-0481: the other AIs in this room that may receive a handoff. T-0482:
    // the same read carries this AI's `canDelegate` and each target's AI id,
    // so the delegation tools can list the roster. One database read for the
    // turn; a lookup failure just means no targets and no delegation tools,
    // and the turn runs unchanged.
    const otherSessions = [...sessions.values()].filter(
      (candidate) => candidate.aiId !== session.aiId && candidate.rooms.has(roomJid),
    );
    let handoffTargets: { aiId: string; nick: string; jid: string }[] = [];
    let canDelegate = false;
    if (otherSessions.length > 0) {
      // Best effort: no handoff targets, the turn runs as before.
      yield* Effect.promise(() =>
        loadDelegationFlags(deps.db, [
          session.aiId,
          ...otherSessions.map((candidate) => candidate.aiId),
        ]),
      ).pipe(
        Effect.map((rows) => {
          canDelegate = rows.find((row) => row.id === session.aiId)?.canDelegate ?? false;
          const accepting = new Set(rows.filter((row) => row.accepts).map((row) => row.id));
          handoffTargets = otherSessions.flatMap((candidate) => {
            const subscription = candidate.rooms.get(roomJid);
            if (subscription === undefined || !accepting.has(candidate.aiId)) {
              return [];
            }
            return [{ aiId: candidate.aiId, nick: subscription.nick, jid: candidate.aiJid }];
          });
        }),
        Effect.catchDefect(() => Effect.void),
      );
    }
    const messages: ChatCompletionMessage[] = buildGroupMessages({
      aiName: ai.name,
      persona: ai.persona,
      senderName,
      today,
      aiJid: ai.jid,
      ...(groupName === undefined ? {} : { groupName }),
      ...(topicName === undefined ? {} : { topicName }),
      ...(handoffTargets.length === 0
        ? {}
        : { handoffNames: handoffTargets.map((target) => target.nick) }),
      history: [...history, ...fresh],
      trigger: { id: trigger.id, body: trigger.body },
      memory,
    });

    // T-0098/T-0444: decide per turn, from the database, whether the
    // trigger's sender is allowed to ask the AI for an action. The role
    // lives on the `roomGate` we already loaded; a plain `member`, an AI
    // sender or an unknown occupant does not get `request_action`. Every
    // room turn still carries the three memory tools (T-0444), so the tool
    // loop always runs.
    const triggerBare = normBareJid(trigger.fromJid);
    const triggerRole = gate.memberRolesByJid.get(triggerBare);
    const allowedForAction = triggerRole === 'owner' || triggerRole === 'admin';
    const actionsList = deps.actions?.listActions() ?? [];
    const allowActions = allowedForAction && actionsList.length > 0;
    // T-0482: offer the delegation tools only when this AI may delegate and
    // at least one accepting AI is in the room. The target list is the id
    // and room nick of each accepting session.
    const delegateTargets =
      canDelegate && handoffTargets.length > 0
        ? handoffTargets.map((target) => ({ id: target.aiId, name: target.nick }))
        : undefined;
    const groupTools = buildGroupTools(allowedForAction ? actionsList : [], delegateTargets);
    // The re-check callback runs at tool-execution time. A `plain
    // member` turn never offers `request_action`, so this never fires for
    // them; for an admin/owner turn it queries the same gate so a
    // demotion that landed between the mention and the tool call
    // short-circuits to `denied: not allowed` without invoking the
    // action gateway.
    const isStillAllowed = (): Promise<boolean> =>
      Effect.runPromise(
        Effect.promise(() =>
          loadRoomGateState(deps.db, room.groupId, deps.xmpp.domain, room.topicId),
        ).pipe(
          Effect.map((fresh) => {
            if (fresh === null) {
              return false;
            }
            const role = fresh.memberRolesByJid.get(triggerBare);
            // T-0109: the sender must still be a group owner/admin AND a member
            // of this topic. Either check failing denies the action.
            return (role === 'owner' || role === 'admin') && fresh.memberJids.has(triggerBare);
          }),
        ),
      );

    // No persona tools in groups and no drafts: the reply goes straight to
    // the room with `composing`/`paused` chat states around it. The 80%
    // warnings go out after it, so the owner reads the answer first. The
    // `live*` wrappers drop the reply when the AI was stopped between the
    // mention arriving and the LLM call resolving. The room reply always
    // goes through the same tool loop as DMs (T-0098, extended by T-0444);
    // the executor carries the room's group id, the re-check callback and
    // whether `request_action` is allowed.
    // T-0106: the guide is appended to the last user turn only when tools
    // are enabled and the room offers `request_action`; the loop runs
    // `toolMaxRounds` rounds with a live progress message.
    const groupProgress = liveProgressReporter(session, roomJid, 'groupchat', ai.jid);
    const groupMessages =
      deps.toolsEnabled === true && allowActions ? withToolGuide(messages) : messages;
    const turnOutcome = yield* Effect.promise(() =>
      runGroupTurn({
        aiId: session.aiId,
        roomJid,
        triggerId: trigger.id,
        senderJid: normBareJid(trigger.fromJid),
        senderName,
        messages: groupMessages,
        baseUrl: baseUrl,
        virtualKey: key,
        model: modelNameForAi(session.aiId),
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        tools: groupTools,
        executeTool: executeToolCall(session, groupChatKey, {
          groupId: room.groupId,
          topicId: room.topicId,
          roomJid,
          triggerId: trigger.id,
          isStillAllowed,
          allowActions,
          delegateTargetIds: new Set(delegateTargets?.map((target) => target.id) ?? []),
        }),
        ...(deps.toolMaxRounds === undefined ? {} : { maxRounds: deps.toolMaxRounds }),
        ...(handoffTargets.length === 0 ? {} : { handoffTargets }),
        checkRoundGate: () => budgetGate.checkDmRoundGate(session),
        onFailure: (reason) => notifyOwnerOfFailure(ctx, session, roomJid, reason),
        reportProgress: groupProgress.reportProgress,
        clearProgress: groupProgress.clearProgress,
        // T-0156: the per-turn counts line (ids and counts only), like the
        // DM path below.
        turnLogger,
        sendMessage: async (to, kind, text, opts) => {
          const sent = await liveSendMessage(session, to, kind, text, opts);
          // T-1176 (AI-8): remember the id so a reply quoting this message
          // wakes the AI without a mention.
          rememberRoomSentId(session, roomJid, sent.id);
          return sent;
        },
        sendTyping: (to, kind, state) => {
          liveSendTyping(session, to, kind, state);
        },
        logger,
        secrets: secretsFor(),
      }),
    );
    // T-0482: a delegated turn stores its result on the row. The worker's
    // posted text (with the `@<boss> ` prefix) is the stored summary; a
    // failed turn stores whatever was posted instead. Log ids only.
    const finishedDelegationId = trigger.delegationId;
    if (finishedDelegationId !== undefined) {
      yield* Effect.promise(() =>
        finishDelegation(deps.db, {
          id: finishedDelegationId,
          aiId: session.aiId,
          status: turnOutcome.kind === 'replied' ? 'completed' : 'failed',
          resultSummary: turnOutcome.text,
        }),
      ).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: errorName(error), aiId: session.aiId, delegationId: finishedDelegationId },
              'AI delegation finish failed',
            );
          }),
        ),
      );
    }
    yield* Effect.promise(() =>
      budgetGate.sendBudgetWarnings({
        aiId: session.aiId,
        chatKey: groupChatKey,
        usage: groupBudget.usage,
        sendWarning: (text) => liveSendMessage(session, roomJid, 'groupchat', text),
      }),
    );
    startCompaction(session, groupChatKey, key);
  });
}
