// effect-plain: moved unchanged from apps/server/src/agents/reply.ts (size split)
import type { ChatKind } from '@zilar/xmpp-core';
import type { FetchLike } from '../ai/litellm-client';
import type { ChatCompletionMessage } from './context';
import { runToolTurn } from './dm-tool-turn';
import { mapFailureToReply, redactError } from './tool-exec';
import {
  ChatCompletionError,
  requestCompletion,
  type CompleteChatInput,
  type ExecuteToolCall,
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
  return result.content;
}

export interface DmTurnDeps {
  aiId: string;
  ownerJid: string;
  messages: ChatCompletionMessage[];
  baseUrl: string;
  virtualKey: string;
  model: string;
  /** Runs one validated persona tool call against the AI's own row. */
  executeTool?: ExecuteToolCall;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Receives the cumulative reply text while the model writes (drafts). */
  onDelta?: (textSoFar: string) => void;
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
  /** T-0106: removes or replaces the live progress message once the final
   * text is sent. Best effort: a throw never fails the turn. */
  clearProgress?: () => Promise<void>;
  /** T-0106: counts logger. The loop logs only counts (rounds, tool
   * calls, ms), never content. Defaults to `deps.logger`. */
  turnLogger?: {
    info: (fields: Record<string, unknown>, message: string) => void;
  };
}

export type DmTurnOutcome = { kind: 'replied'; text: string } | { kind: 'failed'; text: string };

// Runs one turn: typing on, model call, reply into the DM, typing off. When
// the model asks for tools, the shared multi-round `runToolLoop` runs
// (`maxRounds`, default 1, from the gateway's `AGENT_TOOL_MAX_ROUNDS`), and
// the reply carries the fixed persona lines. A model failure posts the
// honest failure text instead — never the raw error. XMPP send failures are
// logged, never thrown: there is nobody left to tell.
export async function runDmTurn(deps: DmTurnDeps): Promise<DmTurnOutcome> {
  const secrets = [deps.virtualKey, ...(deps.secrets ?? [])];
  const tools = deps.tools ?? PERSONA_TOOLS;
  const completionInput = {
    baseUrl: deps.baseUrl,
    virtualKey: deps.virtualKey,
    model: deps.model,
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    ...(deps.secrets === undefined ? {} : { secrets: deps.secrets }),
    ...(deps.onDelta === undefined ? {} : { onDelta: deps.onDelta }),
  };
  deps.sendTyping(deps.ownerJid, 'chat', 'composing');
  try {
    // The loop owns every model call, starting with round 1 (tools
    // offered, exactly like the legacy first call). A text answer comes
    // back as the final text; an empty first reply throws, like before.
    return await runToolTurn(deps, completionInput, secrets, tools);
  } catch (error) {
    const reply = mapFailureToReply(error);
    deps.logger.warn({ err: redactError(error, secrets), aiId: deps.aiId }, 'AI reply failed');
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
