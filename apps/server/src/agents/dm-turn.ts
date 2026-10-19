// effect-plain: the reply pipeline's public edge stays Promise-shaped.
import type { ChatKind } from '@zilar/xmpp-core';
import type { FetchLike } from '../ai/http';
import type { ModelTarget } from '../ai/providers';
import type { ChatUsage } from '../ai/model-client';
import type { ChatCompletionMessage } from './context';
import { runToolTurn } from './dm-tool-turn';
import { finishProgressQuietly } from './turn';
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
import { PERSONA_TOOLS, type ChatToolDefinition } from './tools/definitions';

// The daily-limit notice is fixed except for the formatted per-day cap, so it
// is a function rather than a constant. It goes out at most once per AI per
// chat per UTC day; further messages that day get no reply and no notice.
export function dailyLimitReply(perDayUsd: number): string {
  return `I've reached today's spending limit ($${perDayUsd.toFixed(2)}). I'll be back after 00:00 UTC.`;
}

// The monthly-limit notice, sent under the same once-per-AI-per-chat-per-UTC-day
// rule as the daily one. It wins over the daily text when both limits are
// reached, so the owner hears about the cap that stops the AI for longer.
export function monthlyLimitReply(perMonthUsd: number): string {
  return `I've reached my spending limit for this period ($${perMonthUsd.toFixed(2)}). My owner can raise it in My AIs.`;
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
  target: ModelTarget;
  executeTool?: ExecuteToolCall;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Receives the cumulative reply text while the model writes (drafts). */
  onDelta?: (textSoFar: string) => void;
  /** Receives the token counters of every model call in the turn. */
  onUsage?: (usage: ChatUsage) => void;
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
  tools?: ChatToolDefinition[];
  maxRounds?: number;
  caps?: TurnCaps;
  checkRoundGate?: () => Promise<{ limited: boolean; reply: string } | null>;
  turnStartMs?: number;
  nowMs?: () => number;
  reportProgress?: (stage: string, title?: string) => Promise<string | null>;
  finishProgress?: (state: 'done' | 'failed' | 'stopped') => Promise<void>;
  turnLogger?: {
    info: (fields: Record<string, unknown>, message: string) => void;
  };
  log?: TurnLog;
}

export type DmTurnOutcome =
  | { kind: 'replied'; text: string }
  | { kind: 'failed'; text: string }
  // A turn the owner stopped: the text is always '', and it is never a failure.
  | { kind: 'stopped'; text: string };

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
    return await runToolTurn(deps, completionInput, secrets, tools);
  } catch (error) {
    if (deps.signal?.aborted === true) {
      await finishProgressQuietly(deps, secrets, 'stopped');
      return { kind: 'stopped', text: '' };
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
