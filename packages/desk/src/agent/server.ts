import { chmodSync, unlinkSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { Exit, Schema } from 'effect';
import { DeskRefSchema, DeskSpecSchema, DeskToolCallSchema } from '../hands';
import type { DeskChunk, DeskRef, SnapshotRef } from '../hands';
import { DeskError } from '../protocol';
import type { AgentConfig } from './config';
import type { DeskStatus, Lifecycle } from './lifecycle';

/**
 * One JSON object per newline; a request names a `method`, a reply carries its `id`.
 * Requests decode with `onExcessProperty: 'error'`, so a caller can only send the
 * declared fields — never a host path, an image or a run flag.
 */

const requestIdSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const labelSchema = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/));

export const AgentRequestSchema = Schema.Union([
  Schema.Struct({
    id: requestIdSchema,
    method: Schema.Literal('provision'),
    params: Schema.Struct({ spec: DeskSpecSchema }),
  }),
  Schema.Struct({
    id: requestIdSchema,
    method: Schema.Literal('execute'),
    params: Schema.Struct({ ref: DeskRefSchema, call: DeskToolCallSchema }),
  }),
  Schema.Struct({
    id: requestIdSchema,
    method: Schema.Literal('stop'),
    params: Schema.Struct({ ref: DeskRefSchema, keepWorkspace: Schema.optional(Schema.Boolean) }),
  }),
  Schema.Struct({
    id: requestIdSchema,
    method: Schema.Literal('snapshot'),
    params: Schema.Struct({ ref: DeskRefSchema, label: labelSchema }),
  }),
  Schema.Struct({ id: requestIdSchema, method: Schema.Literal('status') }),
  Schema.Struct({ id: requestIdSchema, method: Schema.Literal('stop_all') }),
]);

export type AgentRequest = typeof AgentRequestSchema.Type;

interface ErrorInfo {
  readonly code: string;
  readonly message: string;
}

interface ErrorReply {
  readonly id: number;
  readonly ok: false;
  readonly error: ErrorInfo;
}

interface ReadyReply {
  readonly id: number;
  readonly ok: true;
  readonly ref: DeskRef;
}

interface QueuedReply {
  readonly id: number;
  readonly ok: true;
  readonly queued: true;
  readonly position: number;
}

interface OkReply {
  readonly id: number;
  readonly ok: true;
}

interface SnapshotReply {
  readonly id: number;
  readonly ok: true;
  readonly snapshot: SnapshotRef;
}

interface StatusReply {
  readonly id: number;
  readonly ok: true;
  readonly status: DeskStatus;
}

interface ChunkReply {
  readonly id: number;
  readonly chunk: DeskChunk;
}

interface DoneReply {
  readonly id: number;
  readonly done: true;
}

export type AgentReply =
  | ErrorReply
  | ReadyReply
  | QueuedReply
  | OkReply
  | SnapshotReply
  | StatusReply
  | ChunkReply
  | DoneReply;

/** Maps any failure to the fixed error taxonomy; never raw host text. */
export function errorInfo(error: unknown): ErrorInfo {
  if (error instanceof DeskError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'tool_failed', message: 'the desk agent failed' };
}

export interface AgentServer {
  readonly socketPath: string;
  readonly server: Server;
  listen(): Promise<void>;
  close(): Promise<void>;
}

type Writer = (reply: AgentReply) => Promise<void>;

/** Serializes writes so concurrent replies never interleave a line. */
function createWriter(socket: Socket): Writer {
  let queue: Promise<void> = Promise.resolve();
  return (reply) => {
    queue = queue.then(
      () =>
        new Promise<void>((resolve) => {
          if (socket.destroyed) {
            resolve();
            return;
          }
          socket.write(`${JSON.stringify(reply)}\n`, () => resolve());
        }),
    );
    return queue;
  };
}

function idOf(parsed: unknown): number {
  const id = (parsed as { id?: unknown } | null)?.id;
  return typeof id === 'number' && Number.isSafeInteger(id) && id >= 0 ? id : 0;
}

async function dispatch(
  request: AgentRequest,
  lifecycle: Lifecycle,
  write: Writer,
  signal: AbortSignal,
): Promise<void> {
  switch (request.method) {
    case 'provision': {
      const result = await lifecycle.provision(request.params.spec);
      if (result.kind === 'queued') {
        await write({ id: request.id, ok: true, queued: true, position: result.position });
      } else {
        await write({ id: request.id, ok: true, ref: result.ref });
      }
      return;
    }
    case 'execute': {
      for await (const chunk of lifecycle.execute(
        request.params.ref,
        request.params.call,
        signal,
      )) {
        await write({ id: request.id, chunk });
      }
      await write({ id: request.id, done: true });
      return;
    }
    case 'stop': {
      await lifecycle.stop(
        request.params.ref,
        request.params.keepWorkspace === undefined
          ? undefined
          : { keepWorkspace: request.params.keepWorkspace },
      );
      await write({ id: request.id, ok: true });
      return;
    }
    case 'snapshot': {
      const snapshot = await lifecycle.snapshot(request.params.ref, request.params.label);
      await write({ id: request.id, ok: true, snapshot });
      return;
    }
    case 'status': {
      await write({ id: request.id, ok: true, status: lifecycle.status() });
      return;
    }
    case 'stop_all': {
      await lifecycle.stopAll();
      await write({ id: request.id, ok: true });
      return;
    }
  }
}

async function handleLine(
  line: string,
  lifecycle: Lifecycle,
  write: Writer,
  signal: AbortSignal,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    await write({
      id: 0,
      ok: false,
      error: { code: 'tool_failed', message: 'invalid JSON request' },
    });
    return;
  }
  const decoded = Schema.decodeUnknownExit(AgentRequestSchema, { onExcessProperty: 'error' })(
    parsed,
  );
  if (!Exit.isSuccess(decoded)) {
    await write({
      id: idOf(parsed),
      ok: false,
      error: { code: 'tool_failed', message: 'invalid request' },
    });
    return;
  }
  try {
    await dispatch(decoded.value, lifecycle, write, signal);
  } catch (error) {
    await write({ id: decoded.value.id, ok: false, error: errorInfo(error) });
  }
}

function handleConnection(socket: Socket, lifecycle: Lifecycle): void {
  const write = createWriter(socket);
  const controller = new AbortController();
  let buffer = '';
  socket.on('close', () => controller.abort());
  socket.on('error', () => {
    // A dropped client is not a server error; the next request reconnects.
  });
  socket.on('data', (data) => {
    buffer += String(data);
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        void handleLine(line, lifecycle, write, controller.signal);
      }
      newline = buffer.indexOf('\n');
    }
  });
}

export function createAgentServer(config: AgentConfig, lifecycle: Lifecycle): AgentServer {
  const server = createServer((socket) => handleConnection(socket, lifecycle));
  return {
    socketPath: config.socketPath,
    server,
    listen() {
      try {
        unlinkSync(config.socketPath);
      } catch {
        // No stale socket, or the path does not exist yet.
      }
      return new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.socketPath, () => {
          // The app connects as non-root, and a unix socket needs write permission on the
          // file; 0666 widens nothing beyond the two containers on the shared volume.
          chmodSync(config.socketPath, 0o666);
          resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        server.close(() => {
          try {
            unlinkSync(config.socketPath);
          } catch {
            // Already removed.
          }
          resolve();
        });
      });
    },
  };
}
