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
  promptDetached(sessionId: string, text: string): void;
  interrupt(sessionId: string): Promise<void>;
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
