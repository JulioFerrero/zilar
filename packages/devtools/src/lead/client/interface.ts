import type { PermissionRule } from '../types.js';

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
