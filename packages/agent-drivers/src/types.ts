// The interface the Zilar gateway uses to control an AI's engine inside a desk.
// It is shaped like the Agent Client Protocol so engines can be swapped per AI later.

export type PermissionEffect = 'allow' | 'ask' | 'deny';

export interface PermissionRule {
  action: string;
  resource: string;
  effect: PermissionEffect;
}

export type PermissionDecision = 'allow_once' | 'allow_always' | 'reject';

export interface SessionModel {
  providerID: string;
  id: string;
}

export interface StartOptions {
  directory: string;
  model: SessionModel;
  title?: string;
  agent?: string;
  rules: PermissionRule[];
}

export interface SessionRef {
  sessionId: string;
}

// Identifies the prompt message that starts a run, so `events()` can ignore everything older.
export interface PromptRef {
  messageId: string;
  createdAt: number;
}

export interface EventsOptions {
  after: PromptRef;
  signal?: AbortSignal;
}

export type AgentEvent =
  | { type: 'text'; messageId: string; text: string }
  | { type: 'reasoning'; messageId: string; text: string }
  | { type: 'tool_call'; messageId: string; callId: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      messageId: string;
      callId: string;
      name: string;
      status: string;
      error?: string;
    }
  | { type: 'permission_request'; requestId: string; action: string; resources: string[] }
  | { type: 'done'; outcome: string }
  | { type: 'error'; message: string };

export interface AgentDriver {
  // Creates a session in a directory with a model and permission rules.
  start(options: StartOptions): Promise<SessionRef>;
  // Returns once the engine has accepted the prompt; the run continues in the background.
  prompt(session: SessionRef, text: string): Promise<PromptRef>;
  // Streams only the run started by `after`, so follow-up prompts never replay old runs.
  events(session: SessionRef, options: EventsOptions): AsyncIterable<AgentEvent>;
  answerPermission(
    session: SessionRef,
    requestId: string,
    decision: PermissionDecision,
    note?: string,
  ): Promise<void>;
  cancel(session: SessionRef): Promise<void>;
}

// A typed failure for driver operations. The operation name and HTTP status are safe to log;
// credentials never are.
export class DriverError extends Error {
  readonly operation: string;
  readonly status: number | undefined;

  constructor(operation: string, message: string, status?: number) {
    super(message);
    this.name = 'DriverError';
    this.operation = operation;
    this.status = status;
  }
}
