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
  /**
   * T-1572: the AI's own bare JID, the `from` of the handoff marker. The group
   * gateway always passes it; with no JID, `wire()` attaches no marker.
   */
  aiJid?: string;
  /** Bare JID of the room the reply goes to. */
  roomJid: string;
  /** The room message that mentioned the AI; the reply points at it. */
  triggerId: string;
  /** Bare JID of the mentioning person, carried on the reply mention. */
  senderJid: string;
  /** Display name of the mentioner, prefixing the reply text. */
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
  /** T-1422: the turn's abort signal; a stop posts no reply and ends the card. */
  signal?: AbortSignal;
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
  /** T-0106: how many tool rounds this turn may run. Defaults to 1 (the
   * legacy single-round shape). The gateway passes `AGENT_TOOL_MAX_ROUNDS`. */
  maxRounds?: number;
  /** T-1611: the turn's caps (chat by default; a computer turn passes its own). */
  caps?: TurnCaps;
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
  /** T-1414: sends the turn's final task-card correction, `stopped` included. */
  finishProgress?: (state: 'done' | 'failed' | 'stopped') => Promise<void>;
  /** T-0106: counts logger. Defaults to a no-op (the group path has no
   * info logger today). */
  turnLogger?: {
    info: (fields: Record<string, unknown>, message: string) => void;
  };
  /** T-0481: other AIs in this room whose `acceptsDelegation` is on, by room
   * nick and bare JID. A `@<nick>` in the reply text (whole word) becomes a
   * mention, up to two targets, so the gateway hands the question over. */
  handoffTargets?: { nick: string; jid: string }[];
  /** T-1290 (AI-10): called once when a turn fails, with the real reason
   * (`mapFailureToReply`). The gateway DMs the AI's owner at most once per
   * day per room; a throw here never fails the turn. */
  onFailure?: (reason: string) => Promise<void>;
  /** T-1426: the turn's session log (best effort). */
  log?: TurnLog;
}
