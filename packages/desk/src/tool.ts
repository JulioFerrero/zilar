import type { Schema } from 'effect';
import type { Workspace } from './paths';
import type { ToolErrorCode } from './protocol';

/** What every tool receives: the root, the caps and the request's abort signal. */
export interface ToolContext {
  readonly workspace: Workspace;
  /** Total stdout+stderr budget for the request (default 1 MB). */
  readonly maxOutputBytes: number;
  /** Per-request timeout used when the request does not carry `timeout_ms`. */
  readonly defaultTimeoutMs: number;
  /** Aborted by the daemon on timeout; long-running tools kill their tree. */
  readonly signal: AbortSignal;
}

/**
 * What every tool returns. `error` is a refusal with a fixed code; a non-zero
 * `exitCode` is a normal result (for example `grep` finding nothing), not an
 * error.
 */
export interface ToolOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly truncated: boolean;
  readonly error?: { readonly code: ToolErrorCode; readonly message: string };
}

export interface ToolEntry {
  readonly args: Schema.ConstraintDecoder<unknown>;
  readonly run: (args: unknown, ctx: ToolContext) => Promise<ToolOutcome>;
}

/** Pairs a tool's args schema with its handler, keeping the handler typed. */
export function defineTool<A>(
  args: Schema.ConstraintDecoder<A>,
  run: (args: A, ctx: ToolContext) => Promise<ToolOutcome>,
): ToolEntry {
  return { args, run: run as (args: unknown, ctx: ToolContext) => Promise<ToolOutcome> };
}

export function outcome(
  partial: Partial<ToolOutcome> & Pick<ToolOutcome, 'exitCode'>,
): ToolOutcome {
  return {
    stdout: partial.stdout ?? '',
    stderr: partial.stderr ?? '',
    exitCode: partial.exitCode,
    truncated: partial.truncated ?? false,
    ...(partial.error === undefined ? {} : { error: partial.error }),
  };
}
