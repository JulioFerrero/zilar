// effect-plain: this module's public edge stays Promise-shaped.
import type { Payload, HandoffLine } from '@zilar/protocol';
import type { SendMessageOptions, ChatKind } from '@zilar/xmpp-core';
import type { FetchLike } from '../ai/http';
import type { ModelTarget } from '../ai/providers';
import type { ChatUsage } from '../ai/model-client';
import type { DmTurnOutcome } from './dm-turn';
import { GROUP_FAILURE_REPLY } from './replies';
import { completionInputOf, runTyped } from './turn';
import { finishTurnFailure, runLoopTurn, sendGroupReply } from './turn';
import { type ExecuteToolCall, type TurnCaps } from './tool-loop';
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
  return runTyped(
    deps,
    deps.roomJid,
    'groupchat',
    () => {
      // Without an executor no tool may run, so the turn advertises none: an
      // improvised call is answered `invalid: unknown tool` by the loop and a
      // plain member can never reach the action gateway.
      const toolTurn = deps.executeTool === undefined ? { ...deps, tools: [] } : deps;
      // Only an advertised tool may run: an improvised call gets
      // `invalid: unknown tool`. `task_status` is the exception: a read-only
      // group tool that `getDelegationForAi` scopes to the two AIs.
      const advertised = new Set((toolTurn.tools ?? []).map((tool) => tool.function.name));
      const execute = toolTurn.executeTool;
      const executeAdvertised: ExecuteToolCall | undefined =
        execute === undefined
          ? undefined
          : (call) =>
              advertised.has(call.tool) || call.tool === TASK_STATUS_TOOL
                ? execute(call)
                : Promise.resolve({ content: 'invalid: unknown tool' });
      return runLoopTurn(toolTurn, {
        completionInput: completionInputOf(deps),
        secrets,
        tools: toolTurn.tools ?? [],
        ...(executeAdvertised === undefined ? {} : { executeTool: executeAdvertised }),
        postedToRoom: true,
        fail: (failure) => failTurn(failure),
        reply: (text, fromModel) => sendGroupReply(deps, secrets, wire(text, fromModel)),
      });
    },
    (error) => failTurn({ error }, false),
  );
}
