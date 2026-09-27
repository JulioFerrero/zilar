import { z } from 'zod';
import {
  DriverError,
  type AgentDriver,
  type AgentEvent,
  type PermissionDecision,
  type StartOptions,
  type SessionRef,
} from './types';

export interface OpenCodeV2DriverOptions {
  baseUrl: string;
  password: string;
  username?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
}

const SESSION_LIMIT = 100;
const DEFAULT_POLL_INTERVAL_MS = 2000;

const SessionIdSchema = z.string().regex(/^ses/);

const CreateSessionResponseSchema = z.object({
  data: z.object({ id: SessionIdSchema }),
});

const PromptResponseSchema = z.object({
  data: z.object({ id: z.string() }),
});

const InterruptResponseSchema = z.object({
  interrupted: z.boolean(),
});

const MessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  content: z.array(z.unknown()).optional(),
  outcome: z.string().optional(),
});

const MessagesResponseSchema = z.object({
  data: z.array(MessageSchema),
});

const TextContentSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const ReasoningContentSchema = z.object({
  type: z.literal('reasoning'),
  text: z.string(),
});

const ToolContentSchema = z.object({
  type: z.literal('tool'),
  id: z.string(),
  name: z.string(),
  state: z.object({
    status: z.string(),
    input: z.unknown(),
    error: z.object({ message: z.string() }).optional(),
  }),
});

const PermissionRequestSchema = z.object({
  id: z.string(),
  action: z.string(),
  resources: z.array(z.string()),
});

const PermissionListResponseSchema = z.object({
  data: z.array(PermissionRequestSchema),
});

const ErrorBodySchema = z.object({ message: z.string() });

type SessionMessage = z.infer<typeof MessageSchema>;
type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

interface MessageProgress {
  // Number of characters already emitted per content item, so appended text becomes a delta.
  textLengths: number[];
  toolCalls: Set<string>;
  toolResults: Set<string>;
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function readErrorMessage(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    const result = ErrorBodySchema.safeParse(parsed);
    return result.success ? result.data.message.slice(0, 500) : undefined;
  } catch {
    return undefined;
  }
}

function toOpenCodeDecision(decision: PermissionDecision): 'once' | 'always' | 'reject' {
  switch (decision) {
    case 'allow_once':
      return 'once';
    case 'allow_always':
      return 'always';
    case 'reject':
      return 'reject';
  }
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort);
  });
}

class OpenCodeV2Driver implements AgentDriver {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;

  constructor(options: OpenCodeV2DriverOptions) {
    this.baseUrl = options.baseUrl;
    this.authHeader = basicAuthHeader(options.username ?? 'opencode', options.password);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async start(options: StartOptions): Promise<SessionRef> {
    const response = await this.request('start', '/api/session', {
      method: 'POST',
      body: {
        title: options.title,
        agent: options.agent,
        model: { providerID: options.model.providerID, id: options.model.id },
        location: { directory: options.directory },
        permissions: options.rules,
      },
    });
    const parsed = await this.parseBody('start', response, CreateSessionResponseSchema);
    return { sessionId: parsed.data.id };
  }

  async prompt(session: SessionRef, text: string): Promise<void> {
    const response = await this.request(
      'prompt',
      `/api/session/${encodeURIComponent(session.sessionId)}/prompt`,
      { method: 'POST', body: { text } },
    );
    await this.parseBody('prompt', response, PromptResponseSchema);
  }

  events(session: SessionRef, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    return this.run(session, signal);
  }

  async answerPermission(
    session: SessionRef,
    requestId: string,
    decision: PermissionDecision,
    note?: string,
  ): Promise<void> {
    const body =
      note === undefined
        ? { decision: toOpenCodeDecision(decision) }
        : { decision: toOpenCodeDecision(decision), message: note };
    await this.request(
      'answerPermission',
      `/api/session/${encodeURIComponent(session.sessionId)}/permission/${encodeURIComponent(requestId)}/reply`,
      { method: 'POST', body },
    );
  }

  async cancel(session: SessionRef): Promise<void> {
    const response = await this.request(
      'cancel',
      `/api/session/${encodeURIComponent(session.sessionId)}/interrupt`,
      { method: 'POST' },
    );
    await this.parseBody('cancel', response, InterruptResponseSchema);
  }

  private async *run(
    session: SessionRef,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<AgentEvent> {
    const progress = new Map<string, MessageProgress>();
    const seenPermissions = new Set<string>();
    let done = false;

    while (!done) {
      if (signal?.aborted) {
        return;
      }

      let messages: SessionMessage[];
      let permissions: PermissionRequest[];
      try {
        messages = await this.listMessages(session.sessionId);
        permissions = await this.listPermissions(session.sessionId);
      } catch (error) {
        if (error instanceof DriverError) {
          yield { type: 'error', message: error.message };
          return;
        }
        throw error;
      }

      // The API returns messages newest first; process them oldest first for a stable order.
      for (const message of [...messages].reverse()) {
        yield* this.messageEvents(message, progress);
        if (message.type === 'idle') {
          done = true;
        }
      }

      for (const request of permissions) {
        if (seenPermissions.has(request.id)) {
          continue;
        }
        seenPermissions.add(request.id);
        yield {
          type: 'permission_request',
          requestId: request.id,
          action: request.action,
          resources: request.resources,
        };
      }

      if (done) {
        return;
      }
      await delay(this.pollIntervalMs, signal);
    }
  }

  private *messageEvents(
    message: SessionMessage,
    progress: Map<string, MessageProgress>,
  ): Generator<AgentEvent> {
    if (message.type === 'idle') {
      yield { type: 'done', outcome: message.outcome ?? 'unknown' };
      return;
    }
    if (message.type !== 'assistant' || message.content === undefined) {
      return;
    }

    const state = progress.get(message.id) ?? {
      textLengths: [],
      toolCalls: new Set<string>(),
      toolResults: new Set<string>(),
    };
    progress.set(message.id, state);

    for (let index = 0; index < message.content.length; index += 1) {
      const item = message.content[index];

      const text = TextContentSchema.safeParse(item);
      if (text.success) {
        const emitted = state.textLengths[index] ?? 0;
        if (text.data.text.length > emitted) {
          yield { type: 'text', messageId: message.id, text: text.data.text.slice(emitted) };
          state.textLengths[index] = text.data.text.length;
        }
        continue;
      }

      const reasoning = ReasoningContentSchema.safeParse(item);
      if (reasoning.success) {
        const emitted = state.textLengths[index] ?? 0;
        if (reasoning.data.text.length > emitted) {
          yield {
            type: 'reasoning',
            messageId: message.id,
            text: reasoning.data.text.slice(emitted),
          };
          state.textLengths[index] = reasoning.data.text.length;
        }
        continue;
      }

      const tool = ToolContentSchema.safeParse(item);
      if (!tool.success) {
        continue;
      }
      const call = tool.data;
      if (!state.toolCalls.has(call.id)) {
        state.toolCalls.add(call.id);
        yield {
          type: 'tool_call',
          messageId: message.id,
          callId: call.id,
          name: call.name,
          input: call.state.input,
        };
      }
      const status = call.state.status;
      if ((status === 'completed' || status === 'error') && !state.toolResults.has(call.id)) {
        state.toolResults.add(call.id);
        const errorMessage = call.state.error?.message;
        yield errorMessage === undefined
          ? { type: 'tool_result', messageId: message.id, callId: call.id, name: call.name, status }
          : {
              type: 'tool_result',
              messageId: message.id,
              callId: call.id,
              name: call.name,
              status,
              error: errorMessage,
            };
      }
    }
  }

  private async listMessages(sessionId: string): Promise<SessionMessage[]> {
    const response = await this.request(
      'events',
      `/api/session/${encodeURIComponent(sessionId)}/message?limit=${SESSION_LIMIT}&order=desc`,
    );
    const parsed = await this.parseBody('events', response, MessagesResponseSchema);
    return parsed.data;
  }

  private async listPermissions(sessionId: string): Promise<PermissionRequest[]> {
    const response = await this.request(
      'events',
      `/api/session/${encodeURIComponent(sessionId)}/permission`,
    );
    const parsed = await this.parseBody('events', response, PermissionListResponseSchema);
    return parsed.data;
  }

  private async request(
    operation: string,
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<Response> {
    const hasBody = init?.body !== undefined;
    const response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
      method: init?.method ?? 'GET',
      headers: {
        authorization: this.authHeader,
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!response.ok) {
      throw new DriverError(
        operation,
        await this.describeFailure(operation, response),
        response.status,
      );
    }
    return response;
  }

  private async describeFailure(operation: string, response: Response): Promise<string> {
    const base = `${operation} failed with HTTP ${response.status}`;
    try {
      const text = await response.text();
      const detail = readErrorMessage(text);
      return detail === undefined ? base : `${base}: ${detail}`;
    } catch {
      return base;
    }
  }

  private async parseBody<T>(
    operation: string,
    response: Response,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new DriverError(operation, `${operation} returned invalid JSON`);
    }
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new DriverError(operation, `${operation} returned an unexpected response body`);
    }
    return result.data;
  }
}

export function createOpenCodeV2Driver(options: OpenCodeV2DriverOptions): AgentDriver {
  return new OpenCodeV2Driver(options);
}
