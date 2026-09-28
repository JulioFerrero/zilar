import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { PermissionRule } from './types.js';

export interface SessionModel {
  providerID: string;
  id: string;
}

export interface CreateSessionOptions {
  title: string;
  agent: string;
  model: SessionModel;
  directory: string;
  permissions: PermissionRule[];
}

export type PermissionDecision = 'once' | 'reject';

const sessionIdSchema = z.object({ id: z.string() });

// The raw OpenCode message/permission payloads vary by version, so the client
// keeps them as unknown and the decision layer reads them defensively.
// `data` is the envelope every `opencode2 api` call returns.
function readDataPayload(file: string): unknown {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const envelope = z.object({ data: z.unknown() }).safeParse(parsed);
  if (!envelope.success) {
    throw new Error('opencode2 response has no data envelope');
  }
  // Note: `envelope.data` is zod's whole parsed value; the payload lives in
  // its `data` property.
  return envelope.data.data;
}

export interface OpenCodeClient {
  createSession(options: CreateSessionOptions): Promise<string>;
  // Fire-and-forget: session.prompt blocks until the turn ends, so the
  // autopilot and launch always send it detached.
  promptDetached(sessionId: string, text: string): void;
  interrupt(sessionId: string): Promise<void>;
  listMessages(sessionId: string, limit: number): Promise<unknown[]>;
  listPermissions(sessionId: string): Promise<unknown[]>;
  replyPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
    message?: string,
  ): Promise<void>;
}

let tempCounter = 0;

function tempFile(prefix: string): string {
  tempCounter += 1;
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${tempCounter}.json`);
}

// Talks to Julio's running OpenCode service through the `opencode2` CLI.
// Quirk (playbook gotcha 2): output is truncated on pipes, so every call
// writes stdout to a temp file and reads that back instead.
export class OpencodeCliClient implements OpenCodeClient {
  private readonly binary: string;

  constructor(binary = 'opencode2') {
    this.binary = binary;
  }

  // `session.interrupt` answers `{"interrupted":…}` with no `data` envelope,
  // so callers that ignore the result pass `expectData: false`.
  private call(
    operation: string,
    params: Record<string, string>,
    body?: unknown,
    expectData = true,
  ): unknown {
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
      if (result.error !== undefined) {
        throw new Error(`opencode2 ${operation} failed to start: ${String(result.error)}`);
      }
      if (result.status !== 0) {
        const stderr = typeof result.stderr === 'string' ? result.stderr : '';
        throw new Error(
          `opencode2 ${operation} exited ${String(result.status)}: ${stderr.slice(0, 300)}`,
        );
      }
      return expectData ? readDataPayload(outFile) : undefined;
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

  async createSession(options: CreateSessionOptions): Promise<string> {
    const data = this.call('session.create', {}, options) as Record<string, unknown>;
    const parsed = sessionIdSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error('session.create response has no id');
    }
    return parsed.data.id;
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

  async interrupt(sessionId: string): Promise<void> {
    this.call('session.interrupt', { sessionID: sessionId }, undefined, false);
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

export { readDataPayload };

// An in-memory OpenCode stand-in for tests. Sessions hold scripted messages
// and permissions, and every mutating call is recorded for assertions.
export interface FakeSession {
  messages: unknown[];
  permissions: unknown[];
}

export class FakeOpenCodeClient implements OpenCodeClient {
  readonly sessions = new Map<string, FakeSession>();
  readonly replied: {
    sessionId: string;
    requestId: string;
    decision: PermissionDecision;
    message: string | undefined;
  }[] = [];
  readonly prompted: { sessionId: string; text: string }[] = [];
  readonly interrupted: string[] = [];
  created: { options: CreateSessionOptions; sessionId: string }[] = [];
  private nextId = 1;

  addSession(sessionId: string, session: FakeSession): void {
    this.sessions.set(sessionId, session);
  }

  private get(sessionId: string): FakeSession {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new Error(`unknown fake session ${sessionId}`);
    }
    return session;
  }

  async createSession(options: CreateSessionOptions): Promise<string> {
    const sessionId = `ses_fake${this.nextId}`;
    this.nextId += 1;
    this.sessions.set(sessionId, { messages: [], permissions: [] });
    this.created.push({ options, sessionId });
    return sessionId;
  }

  promptDetached(sessionId: string, text: string): void {
    this.get(sessionId);
    this.prompted.push({ sessionId, text });
  }

  async interrupt(sessionId: string): Promise<void> {
    this.get(sessionId);
    this.interrupted.push(sessionId);
  }

  async listMessages(sessionId: string, _limit: number): Promise<unknown[]> {
    return [...this.get(sessionId).messages];
  }

  async listPermissions(sessionId: string): Promise<unknown[]> {
    return [...this.get(sessionId).permissions];
  }

  async replyPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
    message?: string,
  ): Promise<void> {
    this.get(sessionId);
    const remaining = this.get(sessionId).permissions.filter(
      (entry) => !isRecord(entry) || entry['id'] !== requestId,
    );
    this.get(sessionId).permissions = remaining;
    this.replied.push({ sessionId, requestId, decision, message });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
