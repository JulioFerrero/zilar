import { Effect, Fiber, Option, Queue, Result, Schema } from 'effect';
import {
  DriverError,
  type AgentDriver,
  type AgentEvent,
  type EventsOptions,
  type PermissionDecision,
  type PromptRef,
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

const SessionIdSchema = Schema.String.check(Schema.isPattern(/^ses/));

const CreateSessionResponseSchema = Schema.Struct({
  data: Schema.Struct({ id: SessionIdSchema }),
});

const PromptResponseSchema = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
    time: Schema.Struct({ created: Schema.Number }),
  }),
});

const InterruptResponseSchema = Schema.Struct({
  interrupted: Schema.Boolean,
});

const MessageSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  time: Schema.optionalKey(Schema.Struct({ created: Schema.Number })),
  content: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  outcome: Schema.optionalKey(Schema.String),
});

const MessagesResponseSchema = Schema.Struct({
  data: Schema.Array(MessageSchema),
});

const TextContentSchema = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
});

const ReasoningContentSchema = Schema.Struct({
  type: Schema.Literal('reasoning'),
  text: Schema.String,
});

const ToolContentSchema = Schema.Struct({
  type: Schema.Literal('tool'),
  id: Schema.String,
  name: Schema.String,
  state: Schema.Struct({
    status: Schema.String,
    input: Schema.Unknown,
    error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
  }),
});

const PermissionRequestSchema = Schema.Struct({
  id: Schema.String,
  action: Schema.String,
  resources: Schema.Array(Schema.String),
});

const PermissionListResponseSchema = Schema.Struct({
  data: Schema.Array(PermissionRequestSchema),
});

const ErrorBodySchema = Schema.Struct({ message: Schema.String });

type SessionMessage = typeof MessageSchema.Type;
type PermissionRequest = typeof PermissionRequestSchema.Type;

interface MessageProgress {
  // Number of characters already emitted per content item, so appended text becomes a delta.
  textLengths: number[];
  toolCalls: Set<string>;
  toolResults: Set<string>;
}

interface RequestDeps {
  baseUrl: string;
  authHeader: string;
  fetchImpl: typeof fetch;
}

// Marks the end of the poll loop on the event queue, so `events()` can finish.
const RUN_END = Symbol('run_end');
// A defect (an unexpected throw) from the poll loop; `run()` rethrows it so the iterator rejects.
interface RunDefect {
  readonly kind: 'defect';
  readonly error: unknown;
}
type RunItem = AgentEvent | typeof RUN_END | RunDefect;

function isRunDefect(item: AgentEvent | RunDefect): item is RunDefect {
  return 'kind' in item && item.kind === 'defect';
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
    const result = Schema.decodeUnknownResult(ErrorBodySchema)(parsed);
    return Result.isSuccess(result) ? result.success.message.slice(0, 500) : undefined;
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

// Keeps only the messages newer than the prompt that started the run. `messages` is newest first.
// The prompt message id is the boundary; if the page no longer holds it, fall back to timestamps.
function selectAfter(
  messages: readonly SessionMessage[],
  after: PromptRef,
): readonly SessionMessage[] {
  const boundary = messages.findIndex((message) => message.id === after.messageId);
  if (boundary >= 0) {
    return messages.slice(0, boundary);
  }
  return messages.filter((message) => (message.time?.created ?? 0) > after.createdAt);
}

function requestEffect(
  deps: RequestDeps,
  operation: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Effect.Effect<Response, DriverError> {
  const hasBody = init?.body !== undefined;
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        deps.fetchImpl(joinUrl(deps.baseUrl, path), {
          method: init?.method ?? 'GET',
          headers: {
            authorization: deps.authHeader,
            ...(hasBody ? { 'content-type': 'application/json' } : {}),
          },
          ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
          signal,
        }),
      catch: () => new DriverError(operation, `${operation} could not reach the server`),
    });
    if (!response.ok) {
      const message = yield* describeFailureEffect(operation, response);
      return yield* Effect.fail(new DriverError(operation, message, response.status));
    }
    return response;
  });
}

function describeFailureEffect(operation: string, response: Response): Effect.Effect<string> {
  return Effect.promise(async () => {
    const base = `${operation} failed with HTTP ${response.status}`;
    try {
      const text = await response.text();
      const detail = readErrorMessage(text);
      return detail === undefined ? base : `${base}: ${detail}`;
    } catch {
      return base;
    }
  });
}

function parseBodyEffect<S extends Schema.ConstraintDecoder<unknown>>(
  operation: string,
  response: Response,
  schema: S,
): Effect.Effect<S['Type'], DriverError> {
  return Effect.gen(function* () {
    const json = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: () => new DriverError(operation, `${operation} returned invalid JSON`),
    });
    const result = Schema.decodeUnknownResult(schema)(json);
    if (Result.isFailure(result)) {
      return yield* Effect.fail(
        new DriverError(operation, `${operation} returned an unexpected response body`),
      );
    }
    return result.success;
  });
}

function listMessagesEffect(
  deps: RequestDeps,
  sessionId: string,
): Effect.Effect<readonly SessionMessage[], DriverError> {
  return Effect.gen(function* () {
    const response = yield* requestEffect(
      deps,
      'events',
      `/api/session/${encodeURIComponent(sessionId)}/message?limit=${SESSION_LIMIT}&order=desc`,
    );
    const parsed = yield* parseBodyEffect('events', response, MessagesResponseSchema);
    return parsed.data;
  });
}

function listPermissionsEffect(
  deps: RequestDeps,
  sessionId: string,
): Effect.Effect<readonly PermissionRequest[], DriverError> {
  return Effect.gen(function* () {
    const response = yield* requestEffect(
      deps,
      'events',
      `/api/session/${encodeURIComponent(sessionId)}/permission`,
    );
    const parsed = yield* parseBodyEffect('events', response, PermissionListResponseSchema);
    return parsed.data;
  });
}

interface RunSnapshot {
  messages: readonly SessionMessage[];
  permissions: readonly PermissionRequest[];
}

function fetchSnapshotEffect(
  deps: RequestDeps,
  sessionId: string,
): Effect.Effect<RunSnapshot, DriverError> {
  return Effect.gen(function* () {
    const messages = yield* listMessagesEffect(deps, sessionId);
    const permissions = yield* listPermissionsEffect(deps, sessionId);
    return { messages, permissions };
  });
}

function* messageEvents(
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

    const text = Schema.decodeUnknownOption(TextContentSchema)(item);
    if (Option.isSome(text)) {
      const emitted = state.textLengths[index] ?? 0;
      if (text.value.text.length > emitted) {
        yield { type: 'text', messageId: message.id, text: text.value.text.slice(emitted) };
        state.textLengths[index] = text.value.text.length;
      }
      continue;
    }

    const reasoning = Schema.decodeUnknownOption(ReasoningContentSchema)(item);
    if (Option.isSome(reasoning)) {
      const emitted = state.textLengths[index] ?? 0;
      if (reasoning.value.text.length > emitted) {
        yield {
          type: 'reasoning',
          messageId: message.id,
          text: reasoning.value.text.slice(emitted),
        };
        state.textLengths[index] = reasoning.value.text.length;
      }
      continue;
    }

    const tool = Schema.decodeUnknownOption(ToolContentSchema)(item);
    if (Option.isNone(tool)) {
      continue;
    }
    const call = tool.value;
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

class OpenCodeV2Driver implements AgentDriver {
  private readonly deps: RequestDeps;
  private readonly pollIntervalMs: number;

  constructor(options: OpenCodeV2DriverOptions) {
    this.deps = {
      baseUrl: options.baseUrl,
      authHeader: basicAuthHeader(options.username ?? 'opencode', options.password),
      fetchImpl: options.fetchImpl ?? fetch,
    };
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  start(options: StartOptions): Promise<SessionRef> {
    return Effect.runPromise(this.startEffect(options));
  }

  prompt(session: SessionRef, text: string): Promise<PromptRef> {
    return Effect.runPromise(this.promptEffect(session, text));
  }

  events(session: SessionRef, options: EventsOptions): AsyncIterable<AgentEvent> {
    return this.run(session, options);
  }

  answerPermission(
    session: SessionRef,
    requestId: string,
    decision: PermissionDecision,
    note?: string,
  ): Promise<void> {
    return Effect.runPromise(this.answerPermissionEffect(session, requestId, decision, note));
  }

  cancel(session: SessionRef): Promise<void> {
    return Effect.runPromise(this.cancelEffect(session));
  }

  private startEffect(options: StartOptions): Effect.Effect<SessionRef, DriverError> {
    const deps = this.deps;
    return Effect.gen(function* () {
      const response = yield* requestEffect(deps, 'start', '/api/session', {
        method: 'POST',
        body: {
          title: options.title,
          agent: options.agent,
          model: { providerID: options.model.providerID, id: options.model.id },
          location: { directory: options.directory },
          permissions: options.rules,
        },
      });
      const parsed = yield* parseBodyEffect('start', response, CreateSessionResponseSchema);
      return { sessionId: parsed.data.id };
    });
  }

  private promptEffect(session: SessionRef, text: string): Effect.Effect<PromptRef, DriverError> {
    const deps = this.deps;
    return Effect.gen(function* () {
      const response = yield* requestEffect(
        deps,
        'prompt',
        `/api/session/${encodeURIComponent(session.sessionId)}/prompt`,
        { method: 'POST', body: { text } },
      );
      const parsed = yield* parseBodyEffect('prompt', response, PromptResponseSchema);
      return { messageId: parsed.data.id, createdAt: parsed.data.time.created };
    });
  }

  private answerPermissionEffect(
    session: SessionRef,
    requestId: string,
    decision: PermissionDecision,
    note?: string,
  ): Effect.Effect<void, DriverError> {
    const deps = this.deps;
    const body =
      note === undefined
        ? { decision: toOpenCodeDecision(decision) }
        : { decision: toOpenCodeDecision(decision), message: note };
    return Effect.gen(function* () {
      yield* requestEffect(
        deps,
        'answerPermission',
        `/api/session/${encodeURIComponent(session.sessionId)}/permission/${encodeURIComponent(requestId)}/reply`,
        { method: 'POST', body },
      );
    });
  }

  private cancelEffect(session: SessionRef): Effect.Effect<void, DriverError> {
    const deps = this.deps;
    return Effect.gen(function* () {
      const response = yield* requestEffect(
        deps,
        'cancel',
        `/api/session/${encodeURIComponent(session.sessionId)}/interrupt`,
        { method: 'POST' },
      );
      yield* parseBodyEffect('cancel', response, InterruptResponseSchema);
    });
  }

  // The poll loop runs as an Effect and pushes events onto a queue; `run` below drains it,
  // so the public `events()` stays an async iterator while cancellation stays Effect-native.
  private runEffect(
    queue: Queue.Queue<RunItem>,
    sessionId: string,
    after: PromptRef,
  ): Effect.Effect<void> {
    const deps = this.deps;
    const pollIntervalMs = this.pollIntervalMs;
    return Effect.gen(function* () {
      const progress = new Map<string, MessageProgress>();
      const seenPermissions = new Set<string>();
      let done = false;

      while (!done) {
        const snapshot = yield* fetchSnapshotEffect(deps, sessionId).pipe(Effect.result);
        if (Result.isFailure(snapshot)) {
          yield* Queue.offer(queue, { type: 'error', message: snapshot.failure.message });
          return;
        }

        // Only the run started by `after`; process it oldest first for a stable order.
        const runMessages = selectAfter(snapshot.success.messages, after);
        for (const message of [...runMessages].reverse()) {
          for (const event of messageEvents(message, progress)) {
            yield* Queue.offer(queue, event);
          }
          if (message.type === 'idle') {
            done = true;
          }
        }

        for (const request of snapshot.success.permissions) {
          if (seenPermissions.has(request.id)) {
            continue;
          }
          seenPermissions.add(request.id);
          yield* Queue.offer(queue, {
            type: 'permission_request',
            requestId: request.id,
            action: request.action,
            resources: [...request.resources],
          });
        }

        if (done) {
          return;
        }
        yield* Effect.sleep(pollIntervalMs);
      }
    }).pipe(
      Effect.catchDefect((error) =>
        Queue.offer(queue, { kind: 'defect', error }).pipe(Effect.asVoid),
      ),
      Effect.ensuring(Queue.offer(queue, RUN_END)),
    );
  }

  // Drains the poll fiber's queue. Hand-written rather than an async generator: with a
  // generator a pending `next()` queues an abandoned `return()` behind it, so a `Queue.take`
  // waiting on a quiet server would hang the caller and leak the fiber. Here `return()`
  // interrupts the fiber directly, which unblocks any pending take via the `RUN_END`
  // finalizer.
  private run(session: SessionRef, options: EventsOptions): AsyncIterableIterator<AgentEvent> {
    const { after, signal } = options;
    let starting: Promise<Queue.Queue<RunItem>> | undefined;
    let fiber: Fiber.Fiber<void, never> | undefined;
    let stopped = false;

    const start = (): Promise<Queue.Queue<RunItem>> => {
      if (starting === undefined) {
        starting = (async () => {
          const queue = await Effect.runPromise(Queue.unbounded<RunItem>());
          if (!stopped) {
            fiber = Effect.runFork(this.runEffect(queue, session.sessionId, after), { signal });
          }
          return queue;
        })();
      }
      return starting;
    };

    const stop = async (): Promise<void> => {
      stopped = true;
      // A concurrent `next()` may still be creating the fiber; wait so we never leave one behind.
      await starting;
      const running = fiber;
      fiber = undefined;
      if (running !== undefined) {
        await Effect.runPromise(Fiber.interrupt(running));
      }
    };

    const iterator: AsyncIterableIterator<AgentEvent> = {
      [Symbol.asyncIterator]() {
        return iterator;
      },
      async next(): Promise<IteratorResult<AgentEvent>> {
        const queue = await start();
        if (stopped) {
          return { done: true, value: undefined };
        }
        const item = await Effect.runPromise(Queue.take(queue));
        if (item === RUN_END) {
          await stop();
          return { done: true, value: undefined };
        }
        if (isRunDefect(item)) {
          await stop();
          throw item.error;
        }
        return { done: false, value: item };
      },
      async return(value?: AgentEvent): Promise<IteratorResult<AgentEvent>> {
        await stop();
        return { done: true, value };
      },
    };

    return iterator;
  }
}

export function createOpenCodeV2Driver(options: OpenCodeV2DriverOptions): AgentDriver {
  return new OpenCodeV2Driver(options);
}
