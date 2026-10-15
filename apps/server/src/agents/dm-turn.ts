// effect-plain: moved unchanged from apps/server/src/agents/reply.ts (size split)
import type { ChatKind } from '@zilar/xmpp-core';
import type { FetchLike } from '../ai/http';
import type { ModelTarget } from '../ai/providers';
import type { ChatUsage } from '../ai/model-client';
import type { ChatCompletionMessage } from './context';
import { runToolTurn } from './dm-tool-turn';
import { finishProgressQuietly } from './turn-stop';
import { cutShortSuffix } from './replies';
import { failureLogFields, mapFailureToReply, redactError } from './tool-exec';
import type { TurnLog } from './log/append';
import {
  ChatCompletionError,
  requestCompletion,
  type CompleteChatInput,
  type ExecuteToolCall,
  type TurnCaps,
} from './tool-loop';
import { PERSONA_TOOLS, type ChatToolDefinition } from './tools';

// The daily-limit notice is fixed except for the formatted per-day cap, so it
// is a function rather than a constant. It goes out at most once per AI per
// chat per UTC day; further messages that day get no reply and no notice.
export function dailyLimitReply(perDayUsd: number): string {
  return `I've reached today's spending limit ($${perDayUsd.toFixed(2)}). I'll be back after 00:00 UTC.`;
}

// The 80% heads-ups go out after the AI's reply for the turn that crossed
// them, at most once per kind per AI per chat per UTC day. Fixed text except
// for the formatted spend and cap.
export function dailyWarningReply(todayUsd: number, perDayUsd: number): string {
  return `Heads up: I've used $${todayUsd.toFixed(2)} of my $${perDayUsd.toFixed(2)} daily limit. I'll pause for the day when it runs out.`;
}

export function monthlyWarningReply(windowUsd: number, perMonthUsd: number): string {
  return `Heads up: I've used $${windowUsd.toFixed(2)} of my $${perMonthUsd.toFixed(2)} limit for this period. You can raise it in My AIs.`;
}

// The plain text call: no tools, so any tool_calls the model improvised are
// ignored and an empty reply is a failure.
export async function completeChat(input: CompleteChatInput): Promise<string> {
  const result = await requestCompletion(input);
  if (result.content === null) {
    throw new ChatCompletionError(200, 'empty reply from the model');
  }
  return result.content + cutShortSuffix(result.finishReason);
}

export interface DmTurnDeps {
  aiId: string;
  ownerJid: string;
  messages: ChatCompletionMessage[];
  /** The AI's own provider connection, resolved per turn. */
  target: ModelTarget;
  /** Runs one validated persona tool call against the AI's own row. */
  executeTool?: ExecuteToolCall;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Receives the cumulative reply text while the model writes (drafts). */
  onDelta?: (textSoFar: string) => void;
  /** Receives the token counters of every model call in the turn. */
  onUsage?: (usage: ChatUsage) => void;
  /** T-1422: the turn's abort signal. When it fires, the model call and the
   * tool loop stop, no reply is posted, and the card ends `stopped`. */
  signal?: AbortSignal;
  /** Called with the exact final reply text right before its XMPP send. Never
   * called for notices on their own or for failure texts. */
  beforeFinalSend?: (text: string) => void;
  sendMessage: (to: string, kind: ChatKind, text: string) => Promise<unknown>;
  sendTyping: (to: string, kind: ChatKind, state: 'composing' | 'paused') => void;
  logger: {
    warn: (fields: Record<string, unknown>, message: string) => void;
  };
  /** Extra secrets to redact from every log line (e.g. the master key). */
  secrets?: readonly string[];
  /** Tools to advertise to the model. Defaults to `PERSONA_TOOLS` (the
   * historical behaviour), so existing callers and tests stay unchanged.
   * When `request_action` is in play the agent gateway passes a list that
   * also includes the `request_action` tool definition. */
  tools?: ChatToolDefinition[];
  /** T-0106: how many tool rounds this turn may run. Defaults to 1:
   * first model call with tools, execute, exactly one follow-up call —
   * today's behaviour, byte for byte. The gateway passes
   * `AGENT_TOOL_MAX_ROUNDS` (6 when `TOOLS_ENABLED` is on). */
  maxRounds?: number;
  /** T-1611: the turn's caps for the shared tool loop. Defaults to
   * `CHAT_TURN_CAPS`; a computer turn passes `COMPUTER_TURN_CAPS`. */
  caps?: TurnCaps;
  /** T-0106: a gate the turn checks before every model call. Null = the AI
   * may proceed (live, under budget, usage unavailable). Non-null with
   * `limited: true` = stop the loop and send the fixed reply. In
   * production the gateway wires the kill switch + budget check; tests
   * wire scripted gates. */
  checkRoundGate?: () => Promise<{ limited: boolean; reply: string } | null>;
  /** T-0106: wall-clock start of the turn (ms). Rounds stop when
   * `TOOL_TURN_WALL_CLOCK_MS` have passed. Defaults to `Date.now()`. */
  turnStartMs?: number;
  /** T-0106: `Date.now` seam for the wall-clock cap. Defaults to Date.now. */
  nowMs?: () => number;
  /** T-0106: posts one live progress message at the first tool round and
   * updates it at each round. Resolves with the progress message id when
   * one was posted (corrections target it); null when no progress message
   * exists (not posted yet, or posting failed). Best effort: a throw or a
   * null never fails the turn. */
  reportProgress?: (stage: string) => Promise<string | null>;
  /** T-1414: sends the turn's final task-card correction (`state: done`,
   * `failed` or `stopped`, with `elapsed_ms` and `summary`). Replaces T-0106's
   * `clearProgress`: the card is left in place, never retracted. Best effort:
   * a throw never fails the turn. */
  finishProgress?: (state: 'done' | 'failed' | 'stopped') => Promise<void>;
  /** T-0106: counts logger. The loop logs only counts (rounds, tool
   * calls, ms), never content. Defaults to `deps.logger`. */
  turnLogger?: {
    info: (fields: Record<string, unknown>, message: string) => void;
  };
  /** T-1426: the turn's session log. Best effort; a write never fails the
   * turn. */
  log?: TurnLog;
}

export type DmTurnOutcome = { kind: 'replied'; text: string } | { kind: 'failed'; text: string };

// Runs one turn: typing on, model call, reply into the DM, typing off. When
// the model asks for tools, the shared multi-round `runToolLoop` runs
// (`maxRounds`, default 1, from the gateway's `AGENT_TOOL_MAX_ROUNDS`), and
// the reply carries the fixed persona lines. A model failure posts the
// honest failure text instead — never the raw error. XMPP send failures are
// logged, never thrown: there is nobody left to tell.
export async function runDmTurn(deps: DmTurnDeps): Promise<DmTurnOutcome> {
  const secrets = [deps.target.apiKey, ...(deps.secrets ?? [])];
  const tools = deps.tools ?? PERSONA_TOOLS;
  const completionInput = {
    target: deps.target,
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    ...(deps.secrets === undefined ? {} : { secrets: deps.secrets }),
    ...(deps.onDelta === undefined ? {} : { onDelta: deps.onDelta }),
    ...(deps.onUsage === undefined ? {} : { onUsage: deps.onUsage }),
    ...(deps.log === undefined ? {} : { log: deps.log }),
    ...(deps.signal === undefined ? {} : { signal: deps.signal }),
  };
  deps.sendTyping(deps.ownerJid, 'chat', 'composing');
  try {
    // The loop owns every model call, starting with round 1 (tools
    // offered, exactly like the legacy first call). A text answer comes
    // back as the final text; an empty first reply throws, like before.
    return await runToolTurn(deps, completionInput, secrets, tools);
  } catch (error) {
    // T-1422: a stopped turn posts no reply; the card ends `stopped`.
    if (deps.signal?.aborted === true) {
      await finishProgressQuietly(deps, secrets, 'stopped');
      return { kind: 'failed', text: '' };
    }
    const reply = mapFailureToReply(error);
    deps.log?.append('error', failureLogFields(error));
    deps.logger.warn({ ...failureLogFields(error), aiId: deps.aiId }, 'AI reply failed');
    try {
      await deps.sendMessage(deps.ownerJid, 'chat', reply);
    } catch (sendError) {
      deps.logger.warn(
        { err: redactError(sendError, secrets), aiId: deps.aiId },
        'AI failure reply could not be sent',
      );
      return { kind: 'failed', text: '' };
    }
    return { kind: 'failed', text: reply };
  } finally {
    deps.sendTyping(deps.ownerJid, 'chat', 'paused');
  }
}
