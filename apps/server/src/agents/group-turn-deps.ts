import type { ChatKind, SendMessageOptions } from '@zilar/xmpp-core';
import type { FetchLike } from '../ai/http';
import type { ModelTarget } from '../ai/providers';
import type { ChatUsage } from '../ai/model-client';
import type { ChatCompletionMessage } from './context';
import type { ExecuteToolCall, TurnCaps } from './tool-loop';
import type { ChatToolDefinition } from './tools';
import type { TurnLog } from './log/append';

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
   * Tools to advertise to the model. Absent (or empty) = the plain
   * `completeChat` path. A group turn always carries the memory tools; persona
   * tools are never offered in a group, and `request_action` appears only when
   * the trigger is allowed to ask for one.
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
