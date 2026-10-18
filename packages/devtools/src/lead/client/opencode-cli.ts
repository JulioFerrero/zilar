import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Result, Schema } from 'effect';
import type {
  CreateSessionOptions,
  OpenCodeClient,
  PermissionDecision,
  SessionModel,
} from './interface.js';
import { readDataPayload, sessionIdSchema } from './payload.js';

let tempCounter = 0;

function tempFile(prefix: string): string {
  tempCounter += 1;
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${tempCounter}.json`);
}

// The full exit record of one `opencode2 api` call: stdout read back from the
// temp file, stderr, the exit status and any spawn error.
interface ExitRecord {
  stdout: string;
  stderr: string;
  status: number | null;
  error: Error | undefined;
}

// Talks to OpenCode through the `opencode2` CLI. Stdout is truncated on pipes, so
// every call writes it to a temp file and reads that back.
export class OpencodeCliClient implements OpenCodeClient {
  private readonly binary: string;

  constructor(binary = 'opencode2') {
    this.binary = binary;
  }

  // Runs the CLI, reading stdout back from a temp file, and returns the full exit
  // record so callers can branch on 404 / already-idle.
  private spawnApi(operation: string, params: Record<string, string>, body?: unknown): ExitRecord {
    const args = ['api', operation];
    for (const [key, value] of Object.entries(params)) {
      args.push('--param', `${key}=${value}`);
    }
    if (body !== undefined) {
      args.push('-d', JSON.stringify(body));
    }
    const outFile = tempFile('opencode-api');
    const fd = fs.openSync(outFile, 'w');
    try {
      const result = spawnSync(this.binary, args, {
        stdio: ['ignore', fd, 'pipe'],
        encoding: 'utf8',
        timeout: 60_000,
      });
      const stderr = typeof result.stderr === 'string' ? result.stderr : '';
      // Whether the CLI exited cleanly or not, the API may have written its
      // body to stdout — read it back from the temp file in both cases.
      let stdout = '';
      try {
        stdout = fs.readFileSync(outFile, 'utf8');
      } catch {
        // File may not exist if spawnSync never wrote anything.
      }
      return { stdout, stderr, status: result.status, error: result.error };
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // Already closed: nothing to do.
      }
      try {
        fs.unlinkSync(outFile);
      } catch {
        // Missing temp file: nothing to clean.
      }
    }
  }

  // `session.interrupt` answers `{"interrupted":…}` with no `data` envelope,
  // so callers that ignore the result pass `expectData: false`.
  private call(
    operation: string,
    params: Record<string, string>,
    body?: unknown,
    expectData = true,
  ): unknown {
    const { stdout, stderr, status, error } = this.spawnApi(operation, params, body);
    if (error !== undefined) {
      throw new Error(`opencode2 ${operation} failed to start: ${String(error)}`);
    }
    if (status !== 0) {
      throw new Error(`opencode2 ${operation} exited ${String(status)}: ${stderr.slice(0, 300)}`);
    }
    return expectData ? readDataPayload(stdout) : undefined;
  }

  async createSession(options: CreateSessionOptions): Promise<string> {
    const data = this.call('session.create', {}, options) as Record<string, unknown>;
    const parsed = Schema.decodeUnknownResult(sessionIdSchema)(data);
    if (Result.isFailure(parsed)) {
      throw new Error('session.create response has no id');
    }
    return parsed.success.id;
  }

  promptDetached(sessionId: string, text: string): void {
    const child = spawn(
      this.binary,
      [
        'api',
        'session.prompt',
        '--param',
        `sessionID=${sessionId}`,
        '-d',
        JSON.stringify({ text }),
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
  }

  // Throws on any non-zero exit: `lead reply` and the autopilot must fail fast; only
  // `switch-model` uses the lenient `tryInterrupt` below.
  async interrupt(sessionId: string): Promise<void> {
    this.call('session.interrupt', { sessionID: sessionId }, undefined, false);
  }

  // Classifies the exit so callers can keep going on an already-idle or unknown
  // session; anything else surfaces as `error` with the raw message.
  async tryInterrupt(
    sessionId: string,
  ): Promise<
    | { kind: 'ok' }
    | { kind: 'not_found' }
    | { kind: 'already_idle' }
    | { kind: 'error'; message: string }
  > {
    const { stdout, stderr, status, error } = this.spawnApi('session.interrupt', {
      sessionID: sessionId,
    });
    if (error !== undefined) {
      return {
        kind: 'error',
        message: `opencode2 session.interrupt failed to start: ${String(error)}`,
      };
    }
    // A 0 exit with `"interrupted":false` means idle: treat it as benign.
    const haystack = `${stdout}\n${stderr}`;
    if (status === 0) {
      if (/"interrupted"\s*:\s*false/.test(haystack)) {
        return { kind: 'already_idle' };
      }
      return { kind: 'ok' };
    }
    const lower = haystack.toLowerCase();
    if (status === 404 || /\bnot\s*found\b/.test(lower) || /\bunknown\s*session\b/.test(lower)) {
      return { kind: 'not_found' };
    }
    if (
      /\balready\s*idle\b/.test(lower) ||
      /\bnot\s*busy\b/.test(lower) ||
      /\bno\s*active\s*session\b/.test(lower)
    ) {
      return { kind: 'already_idle' };
    }
    const excerpt = `${stderr}`.slice(0, 300).trim();
    return {
      kind: 'error',
      message: `opencode2 session.interrupt exited ${String(status)}: ${excerpt || stdout.slice(0, 300)}`,
    };
  }

  async listMessages(sessionId: string, limit: number): Promise<unknown[]> {
    const data = this.call('session.message.list', {
      sessionID: sessionId,
      limit: String(limit),
      order: 'desc',
    });
    return Array.isArray(data) ? data : [];
  }

  async listPermissions(sessionId: string): Promise<unknown[]> {
    const data = this.call('session.permission.list', { sessionID: sessionId });
    return Array.isArray(data) ? data : [];
  }

  async switchModel(sessionId: string, model: SessionModel): Promise<void> {
    this.call('session.switchModel', { sessionID: sessionId }, { model }, false);
  }

  async replyPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
    message?: string,
  ): Promise<void> {
    this.call(
      'session.permission.reply',
      { sessionID: sessionId, requestID: requestId },
      message === undefined ? { decision } : { decision, message },
    );
  }
}
