import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { PermissionRule } from './types.js';

export interface SessionModel {
  providerID: string;
  id: string;
  variant?: string;
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
  // Returns a discriminated outcome instead of throwing so callers like
  // `switch-model` can keep going on a 404 / already-idle session. Anything
  // unexpected comes back as `{ kind: 'error', message }` and is the
  // caller's call.
  tryInterrupt(
    sessionId: string,
  ): Promise<
    | { kind: 'ok' }
    | { kind: 'not_found' }
    | { kind: 'already_idle' }
    | { kind: 'error'; message: string }
  >;
  listMessages(sessionId: string, limit: number): Promise<unknown[]>;
  listPermissions(sessionId: string): Promise<unknown[]>;
  switchModel(sessionId: string, model: SessionModel): Promise<void>;
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

  // Runs the CLI, writes stdout to a temp file (the playbook gotcha: stdout
  // is truncated on pipes), and returns the full exit record so callers can
  // branch on 404 / already-idle instead of parsing error messages.
  private callWithExit(
    operation: string,
    params: Record<string, string>,
    body?: unknown,
  ): { stdout: string; stderr: string; status: number | null; error: Error | undefined } {
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

  // Throws on any non-zero exit. `lead reply` and the autopilot use this and
  // must fail fast when a session is gone — they don't have a quota-fallback
  // path that can tolerate a dead session. Only `lead switch-model` uses the
  // lenient `tryInterrupt` below.
  async interrupt(sessionId: string): Promise<void> {
    this.call('session.interrupt', { sessionID: sessionId }, undefined, false);
  }

  // Classifies the CLI's exit into a discriminated outcome so callers can
  // keep going on expected "the session is already idle / unknown" failures.
  // 404-style exits and any "not busy" / "no active session" message in the
  // payload or stderr are treated as benign; everything else surfaces as
  // `error` with the raw message so a real failure is never silently swallowed.
  async tryInterrupt(
    sessionId: string,
  ): Promise<
    | { kind: 'ok' }
    | { kind: 'not_found' }
    | { kind: 'already_idle' }
    | { kind: 'error'; message: string }
  > {
    const { stdout, stderr, status, error } = this.callWithExit('session.interrupt', {
      sessionID: sessionId,
    });
    if (error !== undefined) {
      return {
        kind: 'error',
        message: `opencode2 session.interrupt failed to start: ${String(error)}`,
      };
    }
    // A 0 exit with `"interrupted":false` is the API's way of saying "I
    // accepted your request but the session was idle": treat it as benign
    // so the switch can move on.
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

export { readDataPayload };

// An in-memory OpenCode stand-in for tests. Sessions hold scripted messages
// and permissions, and every mutating call is recorded for assertions.
export interface FakeSession {
  messages: unknown[];
  permissions: unknown[];
}

export type InterruptOutcome =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'already_idle' }
  | { kind: 'error'; message: string };

export class FakeOpenCodeClient implements OpenCodeClient {
  readonly sessions = new Map<string, FakeSession>();
  readonly replied: {
    sessionId: string;
    requestId: string;
    decision: PermissionDecision;
    message: string | undefined;
  }[] = [];
  readonly prompted: { sessionId: string; text: string }[] = [];
  readonly switched: { sessionId: string; model: SessionModel }[] = [];
  readonly interrupted: string[] = [];
  readonly interruptOutcomes: { sessionId: string; outcome: InterruptOutcome }[] = [];
  // Per-session interrupt script: tests push a result to override the
  // default `{ kind: 'ok' }`. Used to exercise idle / 404 / error paths.
  private interruptScripts = new Map<string, InterruptOutcome[]>();
  created: { options: CreateSessionOptions; sessionId: string }[] = [];
  private nextId = 1;

  addSession(sessionId: string, session: FakeSession): void {
    this.sessions.set(sessionId, session);
  }

  // Queues an interrupt outcome for `sessionId`. Each call consumes the
  // head of the queue; once empty, the fake returns `{ kind: 'ok' }`.
  scriptInterrupt(sessionId: string, outcome: InterruptOutcome): void {
    const queue = this.interruptScripts.get(sessionId) ?? [];
    queue.push(outcome);
    this.interruptScripts.set(sessionId, queue);
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

  // Mirrors the real OpencodeCliClient.interrupt exactly: any non-ok
  // outcome (including a scripted error, an idle session, or an unknown
  // session id) throws. The lenient `tryInterrupt` below is reserved for
  // `lead switch-model`'s quota-fallback path.
  async interrupt(sessionId: string): Promise<void> {
    const outcome = await this.tryInterrupt(sessionId);
    if (outcome.kind !== 'ok') {
      throw new Error(
        outcome.kind === 'error'
          ? outcome.message
          : `session.interrupt ${sessionId} returned ${outcome.kind}`,
      );
    }
  }

  async tryInterrupt(sessionId: string): Promise<InterruptOutcome> {
    // A missing session is reported as `not_found` without recording an
    // interrupt — the real client returns 404 before it touches state.
    const queue = this.interruptScripts.get(sessionId);
    const scripted = queue?.shift();
    const outcome: InterruptOutcome =
      scripted ?? (this.sessions.has(sessionId) ? { kind: 'ok' } : { kind: 'not_found' });
    this.interruptOutcomes.push({ sessionId, outcome });
    if (outcome.kind === 'ok') {
      this.interrupted.push(sessionId);
    }
    return outcome;
  }

  async listMessages(sessionId: string, _limit: number): Promise<unknown[]> {
    return [...this.get(sessionId).messages];
  }

  async listPermissions(sessionId: string): Promise<unknown[]> {
    return [...this.get(sessionId).permissions];
  }

  async switchModel(sessionId: string, model: SessionModel): Promise<void> {
    this.get(sessionId);
    this.switched.push({ sessionId, model });
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
