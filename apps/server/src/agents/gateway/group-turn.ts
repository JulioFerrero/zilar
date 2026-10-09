import { Effect } from 'effect';
import type { ChatMessage } from '@zilar/xmpp-core';
import { modelNameForAi } from '../../ai/model-entry';
import { ensureAiModel, type AiServiceDeps } from '../../ais/service';
import type { KeyCipher } from '../../connections/crypto';
import {
  buildGroupMessages,
  displayNameOf,
  DM_HISTORY_MESSAGE_LIMIT,
  normBareJid,
  type ChatCompletionMessage,
} from '../context';
import { finishDelegation } from '../delegation/service';
import { mapFailureToReply, runGroupTurn, type ExecuteToolCall } from '../reply';
import { buildGroupTools } from '../tools';
import {
  GROUP_RATE_WINDOW_MS,
  GROUP_TURNS_PER_WINDOW,
  ROUND_MAX_AI_TURNS,
  errorName,
  isAiSender,
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type RoomPendingMessage,
  type RoomRound,
} from './contracts';
import {
  loadActiveAi,
  loadDelegationFlags,
  loadEncryptedVirtualKey,
  loadGroupTitle,
  loadRoomGateState,
  loadTopicName,
} from './db';
import type { createBudgetGate } from './budget';
import type { createLiveSession } from './live';
import type { MemoryRunner } from './memory';

type LiveSession = ReturnType<typeof createLiveSession>;

// T-0546 (plan §3, G8a): the group/topic turn extracted from
// `createAgentGateway`. The factory takes the shared session maps, the live
// session, the budget gate, the memory runner and the gateway callbacks the
// moved code closes over, and returns the same `runGroupSessionTurn` the
// gateway's `pumpRoom` calls. A pure move: no logic or wording changed.
// Per-turn context for a `request_action` call in a group (T-0098). The
// `groupId` and `topicId` are the room the AI was woken in — they ride
// along to the action gateway and are used to pick the model-facing
// wording. The `isStillAllowed` callback re-queries the database right
// before the action gateway runs, so a role change that landed between
// the turn starting and the tool executing short-circuits to
// `denied: not allowed` without calling the gateway. `allowActions` is
// false when the trigger may not ask for one, so an improvised
// `request_action` gets `invalid: unknown tool`.
export interface RequestActionContext {
  groupId: string;
  topicId: string;
  /** T-0482: the room JID the turn is answering in, so `delegate` can queue
   * the worker's synthetic trigger and read this AI's room nick. */
  roomJid: string;
  /** T-0482: the message id that opened the turn, stored as `reply_to`. */
  triggerId: string;
  isStillAllowed: () => Promise<boolean>;
  allowActions: boolean;
  /** T-0482: the AI ids in this room that may receive a delegation. Empty
   * when this AI may not delegate or no accepting AI is present, which makes
   * both delegation tools answer `invalid: unknown tool`. */
  delegateTargetIds: ReadonlySet<string>;
}

interface GroupTurnContext {
  deps: AgentGatewayDeps;
  logger: GatewayLogger;
  turnLogger: GatewayLogger;
  baseUrl: string;
  sessions: Map<string, AiSession>;
  roomRounds: Map<string, RoomRound>;
  sessionForAiJid: (bare: string) => AiSession | undefined;
  liveSendMessage: LiveSession['liveSendMessage'];
  liveSendTyping: LiveSession['liveSendTyping'];
  liveProgressReporter: LiveSession['liveProgressReporter'];
  budgetGate: ReturnType<typeof createBudgetGate>;
  loadMemoryContext: MemoryRunner['loadMemoryContext'];
  startCompaction: MemoryRunner['startCompaction'];
  disconnectAi: (aiId: string) => Promise<void>;
  secretsFor: (virtualKey?: string) => string[];
  aiDeps: () => AiServiceDeps;
  executeToolCall: (
    session: AiSession,
    chatKey: string,
    context?: RequestActionContext,
  ) => ExecuteToolCall;
  withToolGuide: (messages: ChatCompletionMessage[]) => ChatCompletionMessage[];
  nowMs: () => number;
}

export function createGroupTurn(ctx: GroupTurnContext) {
  const {
    deps,
    logger,
    turnLogger,
    baseUrl,
    sessions,
    roomRounds,
    sessionForAiJid,
    liveSendMessage,
    liveSendTyping,
    liveProgressReporter,
    budgetGate,
    loadMemoryContext,
    startCompaction,
    disconnectAi,
    secretsFor,
    aiDeps,
    executeToolCall,
    withToolGuide,
    nowMs,
  } = ctx;

  // The Promise-typed calls below are lifted with plain `Effect.promise`: a
  // rejection (or a synchronous throw) dies with the original error, and
  // `catchDefect` handles it where the old code had a `catch`.
  const runGroupSessionTurnEffect = Effect.fnUntraced(function* (
    session: AiSession,
    roomJid: string,
    batch: RoomPendingMessage[],
  ): Effect.fn.Return<void> {
    // The AI id below is the gateway's own: it keyed this session, so nothing
    // here can be aimed at an id taken from message content.
    const ai = yield* Effect.promise(() => loadActiveAi(deps.db, session.aiId)).pipe(
      Effect.catchDefect(() => Effect.succeed(null)),
    );
    if (ai === null) {
      yield* Effect.promise(() => disconnectAi(session.aiId)).pipe(
        Effect.catchDefect(() => Effect.void),
      );
      return;
    }
    const room = session.rooms.get(roomJid);
    if (room === undefined) {
      return;
    }
    const gate = yield* Effect.promise(() =>
      loadRoomGateState(deps.db, room.groupId, deps.xmpp.domain, room.topicId),
    ).pipe(Effect.catchDefect(() => Effect.succeed(null)));
    if (gate === null) {
      logger.warn({ aiId: session.aiId, groupId: room.groupId }, 'AI group state lookup failed');
      return;
    }
    const eligible: RoomPendingMessage[] = [];
    for (const item of batch) {
      const fromBare = normBareJid(item.fromJid);
      if (isAiSender(fromBare)) {
        // T-0481: an AI sender passes only for a queued handoff, and only
        // while it is still a live session in this room. Everything else is
        // the old M2 ban.
        if (item.handoff !== true) {
          continue;
        }
        const senderSession = sessionForAiJid(fromBare);
        if (senderSession === undefined || !senderSession.rooms.has(roomJid)) {
          continue;
        }
        eligible.push(item);
        continue;
      }
      if (!item.fromResolved) {
        // The real JID is unknown: never a turn. That covers both spec
        // clauses at once — an occupant nick matching a room AI would be an
        // AI-to-AI turn, and anything else can't pass the human-membership
        // check below anyway.
        continue;
      }
      // Only a current human member's mention triggers a reply.
      if (!gate.memberJids.has(fromBare)) {
        continue;
      }
      eligible.push(item);
    }
    if (eligible.length === 0) {
      return;
    }
    const trigger = eligible[eligible.length - 1] as RoomPendingMessage;

    // T-0482: a delegated trigger that is dropped before the model call must
    // not leave its row `working` forever. Fails quietly: a lookup or update
    // error here only logs ids. A turn that does reach the model finishes its
    // row below with the worker's text.
    const failDelegationQuietly = Effect.fnUntraced(function* (
      delegationId: string | undefined,
    ): Effect.fn.Return<void> {
      if (delegationId === undefined) {
        return;
      }
      yield* Effect.promise(() =>
        finishDelegation(deps.db, {
          id: delegationId,
          aiId: session.aiId,
          status: 'failed',
        }),
      ).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: errorName(error), aiId: session.aiId, delegationId },
              'AI delegation finish failed',
            );
          }),
        ),
      );
    });

    // The soft daily limit is checked before the rate budget and any model
    // call: a limited AI sends at most one fixed notice per room per UTC day
    // (a plain room message, no mention) and further mentions get nothing.
    // The usage read also decides the 80% warnings, which go out after the
    // reply below — never for a skipped or rate-limited turn. The notice
    // goes through `liveSendMessage` so a stop that lands between the spend
    // read and the notice is silently dropped.
    const groupChatKey = `room:${roomJid}`;
    const groupBudget = yield* Effect.promise(() =>
      budgetGate.checkDailyLimit({
        aiId: session.aiId,
        chatKey: groupChatKey,
        sendNotice: (text) => liveSendMessage(session, roomJid, 'groupchat', text),
      }),
    );
    if (groupBudget.limited) {
      yield* failDelegationQuietly(trigger.delegationId);
      return;
    }

    const atMs = nowMs();
    const recent = (session.roomTurns.get(roomJid) ?? []).filter(
      (stamp) => stamp > atMs - GROUP_RATE_WINDOW_MS,
    );
    if (recent.length >= GROUP_TURNS_PER_WINDOW) {
      session.roomTurns.set(roomJid, recent);
      logger.warn(
        { aiId: session.aiId, groupId: room.groupId, messageId: trigger.id },
        'AI group rate limit reached; dropping the turn',
      );
      yield* failDelegationQuietly(trigger.delegationId);
      return;
    }
    recent.push(atMs);
    session.roomTurns.set(roomJid, recent);

    // T-0479: at most ROUND_MAX_AI_TURNS AI turns per human message per room,
    // across every AI that message woke. The rate stamp just pushed is
    // refunded so a dropped turn does not consume rate budget. A missing round
    // (for example right after a restart) counts as a fresh one.
    const round = roomRounds.get(roomJid);
    if (round !== undefined && round.aiTurns >= ROUND_MAX_AI_TURNS) {
      recent.pop();
      session.roomTurns.set(roomJid, recent);
      logger.warn(
        { aiId: session.aiId, groupId: room.groupId, messageId: trigger.id },
        'AI round budget spent; dropping the turn',
      );
      yield* failDelegationQuietly(trigger.delegationId);
      return;
    }
    if (round !== undefined) {
      round.aiTurns += 1;
    }

    // T-0479: a pure listener wake (every eligible item is a wake, no mention
    // in the batch) shows the short "looking at this" line only once the turn
    // has passed every gate above. A mention turn never posts it.
    if (eligible.every((item) => item.wake === true)) {
      yield* Effect.promise(() =>
        liveSendMessage(session, roomJid, 'groupchat', `${room.nick} is looking at this`),
      ).pipe(Effect.catchDefect(() => Effect.void));
    }

    // The room history the AI reads for a turn is that topic's room only:
    // the `roomJid` above is the joined topic room, and `loadHistory` reads
    // that room alone. The trigger is always inside it (checked at enqueue).
    const senderName = displayNameOf({ fromJid: trigger.fromJid, fromNick: trigger.fromNick });
    // T-0109: names for the topic-aware system prompt. Best effort: a lookup
    // failure keeps the old generic prompt. The topic name goes to the model
    // alone, never into another topic's turn or any log line.
    // Best effort: the turn still runs with the generic prompt.
    const groupName = yield* Effect.promise(() => loadGroupTitle(deps.db, room.groupId)).pipe(
      Effect.map((title) => title ?? undefined),
      Effect.catchDefect(() => Effect.succeed(undefined)),
    );
    let topicName: string | undefined;
    if (room.topicId !== '') {
      topicName = yield* Effect.promise(() => loadTopicName(deps.db, room.topicId)).pipe(
        Effect.map((name) => name ?? undefined),
        Effect.catchDefect(() => Effect.succeed(undefined)),
      );
    }
    let virtualKey: string | undefined;
    const turnBody = Effect.gen(function* () {
      yield* Effect.promise(() => ensureAiModel(aiDeps(), session.aiId));
      const encryptedKey = yield* Effect.promise(() =>
        loadEncryptedVirtualKey(deps.db, session.aiId),
      );
      if (encryptedKey === null) {
        throw new Error(`AI ${session.aiId} has no virtual key`);
      }
      // Decrypted in memory only; never stored, logged or returned.
      const key = (deps.cipher as KeyCipher).decrypt(encryptedKey);
      virtualKey = key;

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
          reportProgress: groupProgress.reportProgress,
          clearProgress: groupProgress.clearProgress,
          // T-0156: the per-turn counts line (ids and counts only), like the
          // DM path below.
          turnLogger,
          sendMessage: (to, kind, text, opts) => liveSendMessage(session, to, kind, text, opts),
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
    yield* turnBody.pipe(
      Effect.catchDefect((error) =>
        Effect.gen(function* () {
          // ensureAiModel, the key lookup and anything else outside the turn: an
          // honest short message in the room, never the raw error.
          logger.warn(
            { err: toRedactedError(error, secretsFor(virtualKey)), aiId: session.aiId },
            'AI group turn failed',
          );
          // T-0482: if this was a delegated turn, the model call never happened
          // (or the turn failed around it), so the row must not stay `working`.
          yield* failDelegationQuietly(trigger.delegationId);
          const reply = mapFailureToReply(error);
          const name = senderName.trim() === '' ? normBareJid(trigger.fromJid) : senderName.trim();
          // There is nobody left to tell when the send itself fails.
          yield* Effect.promise(() =>
            liveSendMessage(session, roomJid, 'groupchat', `@${name} ${reply}`, {
              replyTo: { id: trigger.id },
              mentions: [{ jid: normBareJid(trigger.fromJid), begin: 0, end: name.length + 1 }],
            }),
          ).pipe(Effect.catchDefect(() => Effect.void));
          // Typing state is best-effort.
          yield* Effect.try({
            try: () => liveSendTyping(session, roomJid, 'groupchat', 'paused'),
            catch: (typingError) => typingError,
          }).pipe(Effect.ignore);
        }),
      ),
    );
  });
  return {
    runGroupSessionTurn: (
      session: AiSession,
      roomJid: string,
      batch: RoomPendingMessage[],
    ): Promise<void> => Effect.runPromise(runGroupSessionTurnEffect(session, roomJid, batch)),
  };
}
