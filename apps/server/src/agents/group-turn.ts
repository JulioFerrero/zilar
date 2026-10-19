// effect-plain: this module's public edge stays Promise-shaped.
import type { Payload, HandoffLine } from '@zilar/protocol';
import type { SendMessageOptions, ChatKind } from '@zilar/xmpp-core';
import type { FetchLike } from '../ai/http';
import type { ModelTarget } from '../ai/providers';
import type { ChatUsage } from '../ai/model-client';
import type { DmTurnOutcome } from './dm-turn';
import { runToolLoop } from './tool-rounds';
import { GROUP_FAILURE_REPLY, cutShortSuffix, TRANSIENT_FAILURE_REPLY } from './replies';
import { actionOfCall } from './tool-exec';
import {
  finishProgressQuietly,
  finishTurnFailure,
  remainingTurnBudgetMs,
  sendGroupReply,
  stoppedTurn,
  turnStopped,
} from './turn';
import {
  requestCompletion,
  type CompleteChatInput,
  type ExecuteToolCall,
  type TurnCaps,
} from './tool-loop';
import { TASK_STATUS_TOOL } from './tools/schemas';
import type { TurnLog } from './log/append';
import type { ChatCompletionMessage } from './context';
import type { ChatToolDefinition } from '../ai/model-client';
import { escapeRegExp } from './gateway/addressing';

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

const HANDOFF_TASK_MAX = 200;

export function buildHandoffLine(input: {
  fromJid: string;
  text: string;
  targets: ReadonlyArray<{ nick: string; jid: string }>;
}): HandoffLine | null {
  const to: string[] = [];
  let lastEnd = -1;
  for (const target of input.targets) {
    const nick = target.nick.trim();
    if (nick === '') {
      continue;
    }
    const index = findHandoffIndex(input.text, nick);
    if (index === null) {
      continue;
    }
    if (to.length < 2) {
      to.push(target.jid.toLowerCase());
    }
    lastEnd = Math.max(lastEnd, index + nick.length + 1);
  }
  if (lastEnd === -1) {
    return null;
  }
  return {
    from: input.fromJid,
    to,
    task: oneLineTask(input.text.slice(lastEnd)),
  };
}

// The reply text after the mention, collapsed to one line, with the leading
// `:`, `,`, `-` and spaces stripped, then cut to 200 characters.
function oneLineTask(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,-]+/, '')
    .trimEnd()
    .slice(0, HANDOFF_TASK_MAX);
}
export interface GroupTurnDeps {
  aiId: string;
  /** The AI's own bare JID, the `from` of the handoff marker. With no JID,
   * `wire()` attaches no marker. */
  aiJid?: string;
  roomJid: string;
  triggerId: string;
  syntheticTrigger?: boolean;
  senderJid: string;
  senderName: string;
  messages: ChatCompletionMessage[];
  target: ModelTarget;
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
  /** Receives the token counters of every model call in the turn. */
  onUsage?: (usage: ChatUsage) => void;
  signal?: AbortSignal;
  /**
   * Tools to advertise to the model. Absent or empty: no tools are advertised,
   * and an improvised call is answered `invalid: unknown tool`. A group turn
   * always carries the memory tools; persona tools are never offered in a
   * group, and `request_action` appears only when the trigger is allowed to ask
   * for one.
   */
  tools?: ChatToolDefinition[];
  executeTool?: ExecuteToolCall;
  maxRounds?: number;
  caps?: TurnCaps;
  checkRoundGate?: () => Promise<{ limited: boolean; reply: string } | null>;
  turnStartMs?: number;
  nowMs?: () => number;
  reportProgress?: (stage: string) => Promise<string | null>;
  finishProgress?: (state: 'done' | 'failed' | 'stopped') => Promise<void>;
  turnLogger?: {
    info: (fields: Record<string, unknown>, message: string) => void;
  };
  handoffTargets?: { nick: string; jid: string }[];
  onFailure?: (reason: string) => Promise<void>;
  log?: TurnLog;
}
const MENTION_BOUNDARY = /[\s.,!?;:'"()[\]{}<>|\u2014\u2013-]/;

export function stripLeadingMention(text: string, name: string): string {
  const nick = name.trim();
  if (nick === '') {
    return text;
  }
  const pattern = new RegExp(
    `^@${escapeRegExp(nick)}(?=$|${MENTION_BOUNDARY.source})\\s*[,:]?\\s*`,
    'i',
  );
  let rest = text;
  for (;;) {
    const next = rest.replace(pattern, '');
    if (next === rest || next === '') {
      break;
    }
    rest = next;
  }
  return rest === '' ? text : rest;
}

export async function runGroupTurn(deps: GroupTurnDeps): Promise<DmTurnOutcome> {
  const secrets = [deps.target.apiKey, ...(deps.secrets ?? [])];
  // The model's own leading `@asker` is stripped; the name is still
  // read for that. Fall back to the sender's JID when no display name is known.
  const name = deps.senderName.trim() === '' ? deps.senderJid : deps.senderName.trim();
  // The handoff marker attached to a success reply only. A fixed
  // failure reply never carries it (see the `withHandoff` flag below).
  const handoffPayload = (text: string): Payload | undefined => {
    if (deps.aiJid === undefined) {
      return undefined;
    }
    const line = buildHandoffLine({
      fromJid: deps.aiJid,
      text,
      targets: deps.handoffTargets ?? [],
    });
    return line === null ? undefined : { v: 0, type: 'handoff.line', data: line };
  };
  const wire = (text: string, withHandoff = false): { text: string; opts: SendMessageOptions } => {
    // The room reply does not tag the asker; it quotes the trigger
    // with `replyTo` instead. The model's own leading `@asker` is still
    // stripped so a mention never sneaks back in.
    const body = stripLeadingMention(text, name);
    const mentions: NonNullable<SendMessageOptions['mentions']> = [];
    for (const target of deps.handoffTargets ?? []) {
      // At most two handoff mentions, the same cap `buildHandoffLine` applies.
      if (mentions.length >= 2) {
        break;
      }
      const nick = target.nick.trim();
      if (nick === '') {
        continue;
      }
      const index = findHandoffIndex(body, nick);
      if (index === null) {
        continue;
      }
      mentions.push({
        jid: target.jid.toLowerCase(),
        begin: index,
        end: index + nick.length + 1,
      });
    }
    const payload = withHandoff ? handoffPayload(body) : undefined;
    return {
      text: body,
      opts: {
        ...(deps.syntheticTrigger === true ? {} : { replyTo: { id: deps.triggerId } }),
        mentions,
        ...(payload === undefined ? {} : { payload }),
      },
    };
  };
  const completionInput = {
    target: deps.target,
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    ...(deps.secrets === undefined ? {} : { secrets: deps.secrets }),
    ...(deps.onUsage === undefined ? {} : { onUsage: deps.onUsage }),
    ...(deps.log === undefined ? {} : { log: deps.log }),
    ...(deps.signal === undefined ? {} : { signal: deps.signal }),
  };
  const failTurn = (failure: { error?: unknown; reason?: string }, finishProgress = true) =>
    finishTurnFailure(deps, secrets, {
      ...failure,
      text: GROUP_FAILURE_REPLY,
      send: (text) => {
        const outgoing = wire(text);
        return deps.sendMessage(deps.roomJid, 'groupchat', outgoing.text, outgoing.opts);
      },
      ...(deps.onFailure === undefined ? {} : { beforeSend: deps.onFailure }),
      ...(finishProgress ? {} : { finishProgress: false }),
    });
  deps.sendTyping(deps.roomJid, 'groupchat', 'composing');
  try {
    // Without an executor no tool may run, so the turn advertises none: an
    // improvised call is answered `invalid: unknown tool` by the loop and a
    // plain member can never reach the action gateway.
    const toolTurn = deps.executeTool === undefined ? { ...deps, tools: [] } : deps;
    return await runGroupToolTurn(toolTurn, completionInput, secrets, wire, failTurn);
  } catch (error) {
    return await failTurn({ error }, false);
  } finally {
    deps.sendTyping(deps.roomJid, 'groupchat', 'paused');
  }
}

async function runGroupToolTurn(
  deps: GroupTurnDeps,
  completionInput: Omit<CompleteChatInput, 'messages'>,
  secrets: string[],
  wire: (text: string, withHandoff?: boolean) => { text: string; opts: SendMessageOptions },
  failTurn: (failure: { error?: unknown; reason?: string }) => Promise<DmTurnOutcome>,
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
  let loop: Awaited<ReturnType<typeof runToolLoop>>;
  try {
    loop = await runToolLoop({
      aiId: deps.aiId,
      messages: deps.messages,
      tools,
      completionInput,
      maxRounds,
      ...(deps.caps === undefined ? {} : { caps: deps.caps }),
      ...(executeAdvertised === undefined ? {} : { executeTool: executeAdvertised }),
      logger: deps.logger,
      turnLogger,
      secrets,
      ...(deps.checkRoundGate === undefined ? {} : { checkRoundGate: deps.checkRoundGate }),
      turnStartMs: startedAt,
      nowMs,
      ...(deps.reportProgress === undefined ? {} : { reportProgress: deps.reportProgress }),
      actionOf: (tool, argsJson) => actionOfCall(tool, argsJson),
      ...(deps.log === undefined ? {} : { log: deps.log }),
    });
  } catch (error) {
    return await failTurn({ error });
  }
  if (loop.failure !== null) return await failTurn({ reason: loop.failure.reply });
  // A call already posted the answer into the room (a `blocks` card),
  // so the room gets no echo reply. The card still finishes `done`, exactly
  // like a normal reply would.
  if (loop.postedToRoom) {
    if (turnStopped(deps)) return await stoppedTurn(deps, secrets);
    await finishProgressQuietly(deps, secrets, 'done');
    return { kind: 'replied', text: '' };
  }
  if (loop.text === null) {
    // The caps stopped the loop with no text: one last call so the AI must
    // answer in text. The single-round shape offers tools on that
    // call and answers from its text alone; longer turns go tool-free.
    // The gate runs first: a stop or budget trip before the last call drops
    // the turn with the gate's fixed reply instead of another model call.
    if (deps.checkRoundGate !== undefined) {
      const gate = await deps.checkRoundGate();
      // A stop that landed while the gate was awaited wins over a budget trip:
      // the turn posts no reply and the card ends `stopped`.
      if (turnStopped(deps)) return await stoppedTurn(deps, secrets);
      if (gate !== null && gate.limited) return await failTurn({ reason: gate.reply });
    }
    let text: string;
    let modelText = false;
    try {
      const last = await requestCompletion({
        ...completionInput,
        timeoutMs: remainingTurnBudgetMs(startedAt, nowMs, deps.caps?.wallClockMs),
        messages: loop.messages,
        ...(maxRounds <= 1 ? { tools } : {}),
      });
      if (last.content === null) {
        text = TRANSIENT_FAILURE_REPLY + loop.notices.join('');
      } else {
        text = last.content + cutShortSuffix(last.finishReason) + loop.notices.join('');
        modelText = true;
      }
    } catch (error) {
      return await failTurn({ error });
    }
    if (turnStopped(deps)) return await stoppedTurn(deps, secrets);
    await finishProgressQuietly(deps, secrets, 'done');
    return await sendGroupReply(deps, secrets, wire(text, modelText));
  }
  if (turnStopped(deps)) return await stoppedTurn(deps, secrets);
  await finishProgressQuietly(deps, secrets, 'done');
  return await sendGroupReply(deps, secrets, wire(loop.text + loop.notices.join(''), true));
}
