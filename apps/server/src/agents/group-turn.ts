// effect-plain: moved unchanged from apps/server/src/agents/reply.ts (size split)
import type { ChatKind, SendMessageOptions } from '@zilar/xmpp-core';
import type { FetchLike } from '../ai/litellm-client';
import type { ChatCompletionMessage } from './context';
import type { DmTurnOutcome } from './dm-turn';
import { clearProgressQuietly, runToolLoop } from './dm-tool-turn';
import {
  actionOfCall,
  executeToolCalls,
  followUpMessages,
  mapFailureToReply,
  redactError,
} from './tool-exec';
import {
  ChatCompletionError,
  TRANSIENT_FAILURE_REPLY,
  requestCompletion,
  type ExecuteToolCall,
  type ModelRequestMessage,
} from './tool-loop';
import { TASK_STATUS_TOOL, type ChatToolDefinition } from './tools';

export interface GroupTurnDeps {
  aiId: string;
  /** Bare JID of the room the reply goes to. */
  roomJid: string;
  /** The room message that mentioned the AI; the reply points at it. */
  triggerId: string;
  /** Bare JID of the mentioning person, carried on the reply mention. */
  senderJid: string;
  /** Display name of the mentioner, prefixing the reply text. */
  senderName: string;
  messages: ChatCompletionMessage[];
  baseUrl: string;
  virtualKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  sendMessage: (
    to: string,
    kind: ChatKind,
    text: string,
    opts: SendMessageOptions,
  ) => Promise<unknown>;
  sendTyping: (to: string, kind: ChatKind, state: 'composing' | 'paused') => void;
  logger: {
    warn: (fields: Record<string, unknown>, message: string) => void;
  };
  /** Extra secrets to redact from every log line (e.g. the master key). */
  secrets?: readonly string[];
  /**
   * Tools to advertise to the model. Absent (or empty) = the plain
   * `completeChat` path, unchanged. When present and the model asks for a
   * tool, each call is validated and executed through `executeTool`, the
   * results go back for exactly one follow-up call, and the final text is
   * sent into the room with the `@Name` prefix and the trigger's `replyTo`
   * (T-0098). A group turn always carries the memory tools (T-0444); persona
   * tools are never offered in a group, and `request_action` appears only
   * when the trigger is allowed to ask for one.
   */
  tools?: ChatToolDefinition[];
  executeTool?: ExecuteToolCall;
  /** T-0106: how many tool rounds this turn may run. Defaults to 1:
   * first model call with tools, execute, exactly one follow-up call —
   * today's behaviour, byte for byte. The gateway passes
   * `AGENT_TOOL_MAX_ROUNDS` (6 when `TOOLS_ENABLED` is on). */
  maxRounds?: number;
  /** T-0106: checked before every model call (budget + kill switch). See
   * `DmTurnDeps.checkRoundGate`. */
  checkRoundGate?: () => Promise<{ limited: boolean; reply: string } | null>;
  /** T-0106: wall-clock start of the turn (ms). Defaults to `Date.now()`. */
  turnStartMs?: number;
  /** T-0106: `Date.now` seam for the wall-clock cap. Defaults to Date.now. */
  nowMs?: () => number;
  /** T-0106: posts/updates one live progress message. See
   * `DmTurnDeps.reportProgress`. */
  reportProgress?: (stage: string) => Promise<string | null>;
  /** T-0106: removes or replaces the live progress message. See
   * `DmTurnDeps.clearProgress`. */
  clearProgress?: () => Promise<void>;
  /** T-0106: counts logger. Defaults to a no-op (the group path has no
   * info logger today). */
  turnLogger?: {
    info: (fields: Record<string, unknown>, message: string) => void;
  };
  /** T-0481: other AIs in this room whose `acceptsDelegation` is on, by room
   * nick and bare JID. A `@<nick>` in the reply text (whole word) becomes a
   * mention, up to two targets, so the gateway hands the question over. */
  handoffTargets?: { nick: string; jid: string }[];
}

// T-0481: a handoff mention is only offered when the `@<nick>` in the reply
// text is a whole word: the character after the nick must end the text or be
// whitespace / punctuation. Case-insensitive, and offsets are in the final
// wire text (the `@<sender> ` prefix shifted by its length).
const HANDOFF_BOUNDARY = /[\s.,!?;:'"()[\]{}<>|\u2014\u2013-]/;

function findHandoffIndex(text: string, nick: string): number | null {
  const needle = `@${nick}`;
  const lowerNeedle = needle.toLowerCase();
  for (let index = 0; index + needle.length <= text.length; index += 1) {
    if (text.slice(index, index + needle.length).toLowerCase() !== lowerNeedle) {
      continue;
    }
    const after = text[index + needle.length];
    if (after === undefined || HANDOFF_BOUNDARY.test(after)) {
      return index;
    }
  }
  return null;
}

// Runs one group turn: typing on, one model call (plain or tool loop),
// reply into the room, typing off. The plain path is today's behaviour:
// no tools advertised, and improvised tool calls the model sneaks in are
// answered `invalid: unknown tool` (T-0098: a plain member must never
// reach the action gateway). The tool path is the DM tool
// loop applied to a room: one model call with tools, parsed calls run
// through `executeTool`, one follow-up call, then the final text is sent
// with the `@Name` prefix and `replyTo` on the trigger. A model failure
// posts the honest failure text in the room (never the raw error). XMPP
// send failures are logged, never thrown.
export async function runGroupTurn(deps: GroupTurnDeps): Promise<DmTurnOutcome> {
  const secrets = [deps.virtualKey, ...(deps.secrets ?? [])];
  // The mention needs a non-empty name for its offsets: fall back to the
  // sender's JID when no display name is known.
  const name = deps.senderName.trim() === '' ? deps.senderJid : deps.senderName.trim();
  const wire = (text: string): { text: string; opts: SendMessageOptions } => {
    const prefix = `@${name} `;
    const mentions: NonNullable<SendMessageOptions['mentions']> = [
      { jid: deps.senderJid.toLowerCase(), begin: 0, end: name.length + 1 },
    ];
    for (const target of deps.handoffTargets ?? []) {
      if (mentions.length >= 3) {
        break;
      }
      const nick = target.nick.trim();
      if (nick === '') {
        continue;
      }
      const index = findHandoffIndex(text, nick);
      if (index === null) {
        continue;
      }
      mentions.push({
        jid: target.jid.toLowerCase(),
        begin: prefix.length + index,
        end: prefix.length + index + nick.length + 1,
      });
    }
    return {
      text: prefix + text,
      opts: {
        replyTo: { id: deps.triggerId },
        mentions,
      },
    };
  };
  const completionInput = {
    baseUrl: deps.baseUrl,
    virtualKey: deps.virtualKey,
    model: deps.model,
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    ...(deps.secrets === undefined ? {} : { secrets: deps.secrets }),
  };
  deps.sendTyping(deps.roomJid, 'groupchat', 'composing');
  try {
    if (deps.tools !== undefined && deps.tools.length > 0 && deps.executeTool !== undefined) {
      return await runGroupToolTurn(deps, completionInput, secrets, wire);
    }
    const first = await requestCompletion({
      ...completionInput,
      messages: deps.messages,
    });
    if (first.toolCalls.length === 0) {
      if (first.content === null) {
        throw new ChatCompletionError(200, 'empty reply from the model');
      }
      return await sendGroupReply(deps, secrets, wire(first.content));
    }
    // No tools were advertised, so any tool call the model improvised is
    // invalid: answer `invalid: unknown tool` for each call and make one
    // follow-up call. `executeTool` is deliberately not invoked, so a
    // plain member can never reach the action gateway even when the model
    // tries. A follow-up with no text falls back to the honest failure
    // text, exactly like the tool loop.
    const { toolMessages } = await executeToolCalls({
      toolCalls: first.toolCalls,
      aiId: deps.aiId,
      logger: deps.logger,
      secrets,
    });
    const second = await requestCompletion({
      ...completionInput,
      messages: followUpMessages(deps.messages, first, toolMessages),
    });
    return await sendGroupReply(deps, secrets, wire(second.content ?? TRANSIENT_FAILURE_REPLY));
  } catch (error) {
    const reply = mapFailureToReply(error);
    deps.logger.warn({ err: redactError(error, secrets), aiId: deps.aiId }, 'AI reply failed');
    const outgoing = wire(reply);
    try {
      await deps.sendMessage(deps.roomJid, 'groupchat', outgoing.text, outgoing.opts);
    } catch (sendError) {
      deps.logger.warn(
        { err: redactError(sendError, secrets), aiId: deps.aiId },
        'AI failure reply could not be sent',
      );
      return { kind: 'failed', text: '' };
    }
    return { kind: 'failed', text: outgoing.text };
  } finally {
    deps.sendTyping(deps.roomJid, 'groupchat', 'paused');
  }
}

// The group variant of the DM tool loop: every path below runs the shared
// `runToolLoop` — DM and group turns share one implementation, no copy.
// The only differences are the executor (only an advertised tool may run,
// through `executeAdvertised`) and the final send (the room with `@Name`
// and `replyTo` instead of the owner's DM).
//
// `maxRounds: 1` (the default) keeps today's behaviour byte for byte:
// round 1 offers tools, executes, and the tail makes exactly one more
// follow-up call with tools, answered from its text alone. The
// plain-member guard is unchanged.
async function runGroupToolTurn(
  deps: GroupTurnDeps,
  completionInput: {
    baseUrl: string;
    virtualKey: string;
    model: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    secrets?: readonly string[];
  },
  secrets: string[],
  wire: (text: string) => { text: string; opts: SendMessageOptions },
): Promise<DmTurnOutcome> {
  const tools = deps.tools ?? [];
  const maxRounds = deps.maxRounds ?? 1;
  const startedAt = deps.turnStartMs ?? (deps.nowMs ?? Date.now)();
  const nowMs = deps.nowMs ?? Date.now;
  const turnLogger = deps.turnLogger ?? { info: () => undefined };
  // Only a tool that was advertised may run: anything else the model
  // improvises (a persona tool, say) is answered `invalid: unknown tool`.
  // `task_status` is the one exception: it is a read-only group tool and
  // `getDelegationForAi` scopes the read to the two involved AIs, so it may
  // run even when no delegation targets were advertised.
  const advertised = new Set(tools.map((tool) => tool.function.name));
  const execute = deps.executeTool;
  const executeAdvertised: ExecuteToolCall | undefined =
    execute === undefined
      ? undefined
      : (call) =>
          advertised.has(call.tool) || call.tool === TASK_STATUS_TOOL
            ? execute(call)
            : Promise.resolve({ content: 'invalid: unknown tool' });
  let loop: {
    text: string | null;
    notices: string[];
    failure: { reply: string } | null;
    rounds: number;
    toolCalls: number;
    messages: ModelRequestMessage[];
  };
  try {
    loop = await runToolLoop({
      aiId: deps.aiId,
      messages: deps.messages,
      tools,
      completionInput,
      maxRounds,
      ...(executeAdvertised === undefined ? {} : { executeTool: executeAdvertised }),
      logger: deps.logger,
      turnLogger,
      secrets,
      ...(deps.checkRoundGate === undefined ? {} : { checkRoundGate: deps.checkRoundGate }),
      turnStartMs: startedAt,
      nowMs,
      ...(deps.reportProgress === undefined ? {} : { reportProgress: deps.reportProgress }),
      actionOf: (tool, argsJson) => actionOfCall(tool, argsJson),
    });
  } catch (error) {
    const failure = mapFailureToReply(error);
    deps.logger.warn({ err: redactError(error, secrets), aiId: deps.aiId }, 'AI reply failed');
    if (deps.clearProgress !== undefined) {
      await clearProgressQuietly(deps, secrets);
    }
    return await sendGroupReply(deps, secrets, wire(failure), { failure: true });
  }
  if (loop.failure !== null) {
    if (deps.clearProgress !== undefined) {
      await clearProgressQuietly(deps, secrets);
    }
    return await sendGroupReply(deps, secrets, wire(loop.failure.reply + loop.notices.join('')), {
      failure: true,
    });
  }
  if (loop.text === null) {
    // The caps stopped the loop with no text: one last call so the AI must
    // answer in text. The legacy single-round shape offers tools on that
    // call and answers from its text alone; longer turns go tool-free.
    // The gate runs first: a stop or budget trip before the last call drops
    // the turn with the gate's fixed reply instead of another model call.
    if (deps.checkRoundGate !== undefined) {
      const gate = await deps.checkRoundGate();
      if (gate !== null && gate.limited) {
        if (deps.clearProgress !== undefined) {
          await clearProgressQuietly(deps, secrets);
        }
        return await sendGroupReply(deps, secrets, wire(gate.reply + loop.notices.join('')), {
          failure: true,
        });
      }
    }
    let text: string;
    try {
      const last = await requestCompletion({
        ...completionInput,
        messages: loop.messages,
        ...(maxRounds <= 1 ? { tools } : {}),
      });
      text = (last.content ?? TRANSIENT_FAILURE_REPLY) + loop.notices.join('');
    } catch (error) {
      const failure = mapFailureToReply(error);
      deps.logger.warn({ err: redactError(error, secrets), aiId: deps.aiId }, 'AI reply failed');
      if (deps.clearProgress !== undefined) {
        await clearProgressQuietly(deps, secrets);
      }
      return await sendGroupReply(deps, secrets, wire(failure + loop.notices.join('')), {
        failure: true,
      });
    }
    if (deps.clearProgress !== undefined) {
      await clearProgressQuietly(deps, secrets);
    }
    return await sendGroupReply(deps, secrets, wire(text));
  }
  if (deps.clearProgress !== undefined) {
    await clearProgressQuietly(deps, secrets);
  }
  return await sendGroupReply(deps, secrets, wire(loop.text + loop.notices.join('')));
}

// Sends the text into the room and shapes the outcome. A failure flag is
// carried so the result mirrors the success / failure paths the DM tool
// loop returns (today's `runToolTurn` returns `{ kind: 'failed', text }`
// when the second call throws).
async function sendGroupReply(
  deps: GroupTurnDeps,
  secrets: string[],
  outgoing: { text: string; opts: SendMessageOptions },
  options: { failure: boolean } = { failure: false },
): Promise<DmTurnOutcome> {
  try {
    await deps.sendMessage(deps.roomJid, 'groupchat', outgoing.text, outgoing.opts);
  } catch (error) {
    deps.logger.warn(
      { err: redactError(error, secrets), aiId: deps.aiId },
      'AI group reply could not be sent',
    );
    return { kind: 'failed', text: '' };
  }
  return options.failure
    ? { kind: 'failed', text: outgoing.text }
    : { kind: 'replied', text: outgoing.text };
}
