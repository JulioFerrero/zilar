// effect-plain: the egress registry is an in-memory map plus a newline-JSON unix
// socket the sidecar uses on provision and stop; `Schema` only guards the wire shape.
import { timingSafeEqual } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { Exit, Schema } from 'effect';

/** The default unix socket the proxy's registry listens on. */
export const DEFAULT_REGISTRY_SOCKET = '/run/zilar/egress.sock';

export interface DeskRegistration {
  readonly deskId: string;
  readonly secret: string;
  /** `null` is the open web; a list (possibly empty) is the per-desk allowlist. */
  readonly allowedHosts: readonly string[] | null;
}

function secretsMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export class DeskRegistry {
  private readonly byDesk = new Map<string, DeskRegistration>();

  register(registration: DeskRegistration): void {
    this.byDesk.set(registration.deskId, registration);
  }

  unregister(deskId: string): void {
    this.byDesk.delete(deskId);
  }

  authenticate(deskId: string, secret: string): DeskRegistration | null {
    const registration = this.byDesk.get(deskId);
    if (registration === undefined || !secretsMatch(registration.secret, secret)) {
      return null;
    }
    return registration;
  }

  clear(): void {
    this.byDesk.clear();
  }
}

// `deskName` builds `desk-<aiId>-<projectId>`; both ids cap at 64, so a valid
// desk id can reach 5 + 64 + 1 + 64 = 134 chars (workspace.ts).
const deskIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160));
const secretSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const replySchema = Schema.Struct({ ok: Schema.Boolean });

const RegistryRequestSchema = Schema.Union([
  Schema.Struct({
    id: Schema.Number,
    method: Schema.Literal('register'),
    deskId: deskIdSchema,
    secret: secretSchema,
    allowedHosts: Schema.NullOr(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  }),
  Schema.Struct({
    id: Schema.Number,
    method: Schema.Literal('unregister'),
    deskId: deskIdSchema,
  }),
]);

type RegistryRequest = typeof RegistryRequestSchema.Type;

function decodeRequest(line: string): RegistryRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const decoded = Schema.decodeUnknownExit(RegistryRequestSchema, { onExcessProperty: 'error' })(
    parsed,
  );
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

export interface RegistryServer {
  readonly socketPath: string;
  listen(): Promise<void>;
  close(): Promise<void>;
}

function replyFor(request: RegistryRequest | null, registry: DeskRegistry): string {
  if (request === null) {
    return JSON.stringify({ id: 0, ok: false });
  }
  if (request.method === 'register') {
    registry.register({
      deskId: request.deskId,
      secret: request.secret,
      allowedHosts: request.allowedHosts,
    });
  } else {
    registry.unregister(request.deskId);
  }
  return JSON.stringify({ id: request.id, ok: true });
}

export function createRegistryServer(registry: DeskRegistry, socketPath: string): RegistryServer {
  const server: Server = createServer((socket: Socket) => {
    let buffer = '';
    socket.on('error', () => {
      // A dropped admin client just drops its request.
    });
    socket.on('data', (data) => {
      buffer += String(data);
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) {
          socket.write(`${replyFor(decodeRequest(line), registry)}\n`);
        }
        newline = buffer.indexOf('\n');
      }
    });
  });
  return {
    socketPath,
    listen() {
      try {
        unlinkSync(socketPath);
      } catch {
        // No stale socket, or the path does not exist yet.
      }
      return new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => resolve());
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        server.close(() => {
          try {
            unlinkSync(socketPath);
          } catch {
            // Already removed.
          }
          resolve();
        });
      });
    },
  };
}

export interface RegistryClient {
  register(registration: DeskRegistration): Promise<void>;
  unregister(deskId: string): Promise<void>;
}

/** True only when the reply line is a well-formed `{ ok: true }`. */
function isOkReply(line: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return false;
  }
  const decoded = Schema.decodeUnknownExit(replySchema)(parsed);
  return Exit.isSuccess(decoded) && decoded.value.ok;
}

function call(socketPath: string, payload: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = connect(socketPath);
    let buffer = '';
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      client.destroy();
      finish();
    };
    client.on('error', (error) => settle(() => reject(error)));
    client.on('connect', () => client.write(`${JSON.stringify(payload)}\n`));
    client.on('data', (data) => {
      buffer += String(data);
      const newline = buffer.indexOf('\n');
      if (newline === -1) {
        return;
      }
      const ok = isOkReply(buffer.slice(0, newline).trim());
      settle(() => (ok ? resolve() : reject(new Error('egress registry refused the request'))));
    });
    client.on('close', () =>
      settle(() => reject(new Error('egress registry closed without replying'))),
    );
  });
}

export function createRegistryClient(socketPath: string): RegistryClient {
  return {
    register(registration) {
      return call(socketPath, { id: 1, method: 'register', ...registration });
    },
    unregister(deskId) {
      return call(socketPath, { id: 1, method: 'unregister', deskId });
    },
  };
}
