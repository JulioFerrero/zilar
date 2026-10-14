import { chmodSync, unlinkSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { Exit, Schema } from 'effect';
import type { AgentConfig } from './config';
import type { Lifecycle } from './lifecycle';
import { AgentRequestSchema, errorInfo, type AgentReply, type AgentRequest } from './wire';

/** A unix-socket server that speaks the newline-JSON protocol in `wire.ts`. */
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
          // The app reaches this socket from its own container as a non-root
          // user, and connecting to a unix socket needs write permission on
          // the file. The socket lives on a named volume shared only by the
          // app and the sidecar, so 0666 widens nothing beyond those two.
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
