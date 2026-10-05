import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export const FAKE_USERNAME = 'opencode';
export const FAKE_PASSWORD = 'super-secret-password';

export interface FakeFrame {
  messages: unknown[];
  permissions: unknown[];
}

export interface FakePromptResponse {
  id: string;
  createdAt: number;
}

export interface RecordedRequest {
  method: string;
  path: string;
  auth: string | undefined;
  body: unknown;
}

export interface FakeServerOptions {
  frames?: FakeFrame[];
  password?: string;
  requireAuth?: boolean;
  // Prompt responses, in order; the last one is repeated. Defaults to a single `msg_user_1`.
  promptResponses?: FakePromptResponse[];
  // Makes every request fail with this status, to exercise driver error handling.
  fail?: { status: number; body?: string };
  // Returns invalid JSON for one endpoint, to check the driver never crashes.
  malformedJson?: 'create' | 'message';
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// A minimal stand-in for OpenCode v2's HTTP API. It requires basic auth and replays a
// scripted run: each `GET .../message` call advances to the next frame, and the matching
// `GET .../permission` returns that frame's pending requests.
export class FakeOpenCodeServer {
  baseUrl = '';
  readonly requests: RecordedRequest[] = [];

  private readonly httpServer: Server;
  private readonly frames: FakeFrame[];
  private readonly expectedAuth: string;
  private readonly requireAuth: boolean;
  private readonly promptResponses: FakePromptResponse[];
  private readonly fail: { status: number; body?: string } | undefined;
  private readonly malformedJson: 'create' | 'message' | undefined;
  private frameIndex = 0;
  private promptIndex = 0;
  private activeFrame: FakeFrame | undefined;

  private constructor(options: FakeServerOptions) {
    this.frames = options.frames ?? [];
    this.expectedAuth = basicAuthHeader(FAKE_USERNAME, options.password ?? FAKE_PASSWORD);
    this.requireAuth = options.requireAuth ?? true;
    this.promptResponses = options.promptResponses ?? [{ id: 'msg_user_1', createdAt: 0 }];
    this.fail = options.fail;
    this.malformedJson = options.malformedJson;
    this.httpServer = createServer((request, response) => {
      this.handleRequest(request, response);
    });
  }

  static async start(options: FakeServerOptions = {}): Promise<FakeOpenCodeServer> {
    const server = new FakeOpenCodeServer(options);
    await new Promise<void>((resolve) => {
      server.httpServer.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.httpServer.address();
    if (address === null || typeof address === 'string') {
      throw new Error('the fake server did not bind a TCP port');
    }
    server.baseUrl = `http://127.0.0.1:${address.port}`;
    return server;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.httpServer.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const rawPath = request.url ?? '/';
      const method = request.method ?? 'GET';
      this.requests.push({
        method,
        path: rawPath,
        auth: request.headers.authorization,
        body: parseJson(Buffer.concat(chunks).toString('utf8')),
      });

      if (this.requireAuth && request.headers.authorization !== this.expectedAuth) {
        this.sendJson(response, 401, { _tag: 'UnauthorizedError', message: 'unauthorized' });
        return;
      }
      if (this.fail !== undefined) {
        this.sendRaw(response, this.fail.status, this.fail.body ?? '', 'application/json');
        return;
      }

      const path = new URL(rawPath, 'http://localhost').pathname;
      if (method === 'POST' && path === '/api/session') {
        if (this.malformedJson === 'create') {
          this.sendRaw(response, 200, 'not-json', 'application/json');
          return;
        }
        this.sendJson(response, 200, { data: { id: 'ses_1' } });
        return;
      }
      if (method === 'POST' && path === '/api/session/ses_1/prompt') {
        const index = Math.min(this.promptIndex, Math.max(this.promptResponses.length - 1, 0));
        const prompt = this.promptResponses[index] ?? { id: 'msg_user_1', createdAt: 0 };
        this.promptIndex += 1;
        this.sendJson(response, 200, {
          data: { id: prompt.id, time: { created: prompt.createdAt } },
        });
        return;
      }
      if (method === 'GET' && path === '/api/session/ses_1/message') {
        if (this.malformedJson === 'message') {
          this.sendRaw(response, 200, 'not-json', 'application/json');
          return;
        }
        const index = Math.min(this.frameIndex, Math.max(this.frames.length - 1, 0));
        const frame = this.frames[index] ?? { messages: [], permissions: [] };
        this.activeFrame = frame;
        this.frameIndex += 1;
        this.sendJson(response, 200, { data: [...frame.messages].reverse() });
        return;
      }
      if (method === 'GET' && path === '/api/session/ses_1/permission') {
        this.sendJson(response, 200, { data: this.activeFrame?.permissions ?? [] });
        return;
      }
      if (method === 'POST' && /^\/api\/session\/ses_1\/permission\/[^/]+\/reply$/.test(path)) {
        response.writeHead(204);
        response.end();
        return;
      }
      if (method === 'POST' && path === '/api/session/ses_1/interrupt') {
        this.sendJson(response, 200, { interrupted: true });
        return;
      }
      this.sendJson(response, 404, { _tag: 'NotFoundError', message: 'not found' });
    });
  }

  private sendJson(response: ServerResponse, status: number, body: unknown): void {
    this.sendRaw(response, status, JSON.stringify(body), 'application/json');
  }

  private sendRaw(
    response: ServerResponse,
    status: number,
    body: string,
    contentType: string,
  ): void {
    response.writeHead(status, { 'content-type': contentType });
    response.end(body);
  }
}
