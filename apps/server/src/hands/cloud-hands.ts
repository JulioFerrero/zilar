import { connect, type Socket } from 'node:net';
import { Schema } from 'effect';
import {
  DeskError,
  DeskQueued,
  ErrorInfoSchema,
  type DeskChunk,
  type DeskRef,
  type DeskToolCall,
  type Hands,
} from '@zilar/desk';

/**
 * The app-side `Hands` over the desk-agent unix socket
 * (`packages/desk/src/agent/server.ts`), speaking the package's own shapes
 * (`packages/desk/src/hands.ts`); every reply is re-validated against the wire
 * schema. The sidecar still refuses anything but the pinned image and the
 * declared fields.
 */

// Re-exported so every existing importer keeps working. `HandsError` and
// `HandsQueued` are the package's `DeskError` and `DeskQueued` under this
// module's old names.
export type {
  DeskChunk,
  DeskKey,
  DeskRef,
  DeskSpec,
  DeskToolCall,
  Hands,
  SnapshotRef,
} from '@zilar/desk';
export { DeskError as HandsError, DeskQueued as HandsQueued };

const requestIdSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const keySchema = Schema.Struct({ aiId: Schema.String, projectId: Schema.String });
const refSchema = Schema.Struct({ id: Schema.String, key: keySchema });
const chunkSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('stdout'), data: Schema.String }),
  Schema.Struct({ type: Schema.Literal('stderr'), data: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('exit'),
    code: Schema.Number.check(Schema.isInt()),
    truncated: Schema.Boolean,
  }),
]);
const snapshotSchema = Schema.Struct({
  deskId: Schema.String,
  label: Schema.String,
  bytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});

const provisionReplySchema = Schema.Union([
  Schema.Struct({ id: requestIdSchema, ok: Schema.Literal(false), error: ErrorInfoSchema }),
  Schema.Struct({
    id: requestIdSchema,
    ok: Schema.Literal(true),
    queued: Schema.Literal(true),
    position: requestIdSchema,
  }),
  Schema.Struct({ id: requestIdSchema, ok: Schema.Literal(true), ref: refSchema }),
]);

const snapshotReplySchema = Schema.Union([
  Schema.Struct({ id: requestIdSchema, ok: Schema.Literal(false), error: ErrorInfoSchema }),
  Schema.Struct({ id: requestIdSchema, ok: Schema.Literal(true), snapshot: snapshotSchema }),
]);

const okReplySchema = Schema.Union([
  Schema.Struct({ id: requestIdSchema, ok: Schema.Literal(false), error: ErrorInfoSchema }),
  Schema.Struct({ id: requestIdSchema, ok: Schema.Literal(true) }),
]);

const executeLineSchema = Schema.Union([
  Schema.Struct({ id: requestIdSchema, ok: Schema.Literal(false), error: ErrorInfoSchema }),
  Schema.Struct({ id: requestIdSchema, done: Schema.Literal(true) }),
  Schema.Struct({ id: requestIdSchema, chunk: chunkSchema }),
]);

function openSocket(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

async function* socketLines(socket: Socket): AsyncIterable<string> {
  let buffer = '';
  for await (const data of socket) {
    buffer += String(data);
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        yield line;
      }
      newline = buffer.indexOf('\n');
    }
  }
}

/** Sends one request and resolves with its single reply line (parsed). */
function requestReply(socketPath: string, payload: unknown): Promise<unknown> {
  return (async () => {
    const socket = await openSocket(socketPath);
    try {
      socket.write(`${JSON.stringify(payload)}\n`);
      for await (const line of socketLines(socket)) {
        return JSON.parse(line);
      }
      throw new DeskError('jail_unavailable', 'the desk agent closed the connection');
    } finally {
      socket.destroy();
    }
  })();
}

export function createCloudHands(socketPath: string): Hands {
  const send = (payload: unknown): Promise<unknown> => requestReply(socketPath, payload);
  return {
    async provision(spec) {
      const reply = Schema.decodeUnknownSync(provisionReplySchema)(
        await send({ id: 1, method: 'provision', params: { spec } }),
      );
      if ('error' in reply) {
        throw new DeskError(reply.error.code, reply.error.message);
      }
      if ('queued' in reply) {
        throw new DeskQueued(reply.position);
      }
      return reply.ref;
    },
    execute(ref, call, signal) {
      return runExecute(socketPath, ref, call, signal);
    },
    async stop(ref, opts) {
      const reply = Schema.decodeUnknownSync(okReplySchema)(
        await send({
          id: 1,
          method: 'stop',
          params: {
            ref,
            ...(opts?.keepWorkspace === undefined ? {} : { keepWorkspace: opts.keepWorkspace }),
          },
        }),
      );
      if ('error' in reply) {
        throw new DeskError(reply.error.code, reply.error.message);
      }
    },
    async snapshot(ref, label) {
      const reply = Schema.decodeUnknownSync(snapshotReplySchema)(
        await send({ id: 1, method: 'snapshot', params: { ref, label } }),
      );
      if ('error' in reply) {
        throw new DeskError(reply.error.code, reply.error.message);
      }
      return reply.snapshot;
    },
  };
}

async function* runExecute(
  socketPath: string,
  ref: DeskRef,
  call: DeskToolCall,
  signal?: AbortSignal,
): AsyncIterable<DeskChunk> {
  const socket = await openSocket(socketPath);
  const onAbort = (): void => {
    socket.destroy();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    socket.write(`${JSON.stringify({ id: 1, method: 'execute', params: { ref, call } })}\n`);
    for await (const line of socketLines(socket)) {
      const decoded = Schema.decodeUnknownSync(executeLineSchema)(JSON.parse(line));
      if ('error' in decoded) {
        throw new DeskError(decoded.error.code, decoded.error.message);
      }
      if ('done' in decoded) {
        return;
      }
      yield decoded.chunk;
    }
    throw new DeskError('tool_failed', 'the desk agent closed the stream');
  } finally {
    signal?.removeEventListener('abort', onAbort);
    socket.destroy();
  }
}
