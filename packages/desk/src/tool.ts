import type { Schema } from 'effect';
import type { Workspace } from './paths';
import type { ToolErrorCode } from './protocol';

export interface ToolContext {
  readonly workspace: Workspace;
  /** Total stdout+stderr budget for the request (default 1 MB). */
  readonly maxOutputBytes: number;
  readonly defaultTimeoutMs: number;
  readonly signal: AbortSignal;
}

/**
 * `error` is a refusal with a fixed code; a non-zero `exitCode` is a normal
 * result (e.g. `grep` finding nothing).
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
