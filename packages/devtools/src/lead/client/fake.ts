import type {
  CreateSessionOptions,
  OpenCodeClient,
  PermissionDecision,
  SessionModel,
} from './interface.js';

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
  // Per-session interrupt script: tests push a result to override the default `{ kind: 'ok' }`.
  private interruptScripts = new Map<string, InterruptOutcome[]>();
  created: { options: CreateSessionOptions; sessionId: string }[] = [];
  private nextId = 1;

  addSession(sessionId: string, session: FakeSession): void {
    this.sessions.set(sessionId, session);
  }

  // Queues an interrupt outcome for `sessionId`; once empty the fake returns ok.
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

  // Mirrors the real interrupt: any non-ok outcome throws. The lenient `tryInterrupt`
  // below is only for `lead switch-model`'s quota fallback.
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
