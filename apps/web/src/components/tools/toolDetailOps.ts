import { Data, Effect, Result, Schema } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import {
  getToolDetail,
  listToolRuns,
  listToolVersions,
  runToolNow,
  type ToolDetail,
  type ToolRun,
  type ToolRunResult,
  type ToolVersion,
} from '@/lib/tools';
import { fromApi } from '@/lib/effect/api-effect';
import { type ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting } from '@/lib/effect/use-action';

const MAX_RUN_INPUT_BYTES = 4 * 1024;

/** The run input is any JSON value, decoded from its text by Effect Schema. */
const RUN_INPUT_JSON = Schema.fromJsonString(Schema.Unknown);

class InputNotJson extends Data.TaggedError('InputNotJson') {}
class InputTooLarge extends Data.TaggedError('InputTooLarge') {}

export type RunFailure = InputNotJson | InputTooLarge | ApiFailure;

export interface LoadedTool {
  readonly detail: ToolDetail;
  readonly versions: ToolVersion[];
  readonly runs: ToolRun[];
}

export function hostsLine(hosts: readonly string[]): string {
  return hosts.length === 0 ? 'no sites' : hosts.join(', ');
}

export function runStatusText(run: ToolRun): string {
  const at = new Date(run.createdAt);
  const label = run.status === 'ok' ? 'ok' : `error (${run.errorKind ?? 'failed'})`;
  return `${label} · v${run.version} · ${run.trigger} · ${run.durationMs} ms · ${at.toLocaleString()}`;
}

/** The API's own message, or the fallback for a failure that was not an API answer. */
export function failureText(failure: ApiFailure | undefined, fallback: string): string {
  if (failure === undefined || (failure.status === 0 && failure.code === 'unknown_error')) {
    return fallback;
  }
  return failure.message;
}

/** The typed failure of a call that has ended; a call still running shows none. */
export function settledFailure<A, E>(state: AsyncResult.AsyncResult<A, E>): E | undefined {
  return isWaiting(state) ? undefined : failureOf(state);
}

export function loadDetail(toolId: string): Effect.Effect<LoadedTool, ApiFailure> {
  return Effect.all(
    {
      detail: fromApi(() => getToolDetail(toolId)),
      versions: fromApi(() => listToolVersions(toolId)),
      runs: fromApi(() => listToolRuns(toolId)),
    },
    { concurrency: 'unbounded' },
  );
}

/** Checks the optional JSON input (max 4 KB), then runs the tool once. */
export function runToolWithInput(
  toolId: string,
  text: string,
): Effect.Effect<ToolRunResult, RunFailure> {
  const trimmed = text.trim();
  const input: Effect.Effect<unknown, InputNotJson | InputTooLarge> =
    trimmed === '' ? Effect.succeed(undefined) : parseRunInput(trimmed);
  return input.pipe(
    Effect.andThen((value) =>
      fromApi(() => (value === undefined ? runToolNow(toolId) : runToolNow(toolId, value))),
    ),
  );
}

function parseRunInput(trimmed: string): Effect.Effect<unknown, InputNotJson | InputTooLarge> {
  const decoded = Schema.decodeUnknownResult(RUN_INPUT_JSON)(trimmed);
  if (!Result.isSuccess(decoded)) {
    return Effect.fail(new InputNotJson());
  }
  if (new Blob([trimmed]).size > MAX_RUN_INPUT_BYTES) {
    return Effect.fail(new InputTooLarge());
  }
  return Effect.succeed(decoded.success);
}

/** The text under the run input field, for an input the run never sent. */
export function inputErrorText(failure: RunFailure | undefined): string | undefined {
  if (failure?._tag === 'InputNotJson') {
    return 'Input must be valid JSON.';
  }
  if (failure?._tag === 'InputTooLarge') {
    return 'Input must be at most 4 KB.';
  }
  return undefined;
}

/** The text under the Run button, for a run the API refused or failed. */
export function runErrorText(failure: RunFailure | undefined): string | undefined {
  if (
    failure === undefined ||
    failure._tag === 'InputNotJson' ||
    failure._tag === 'InputTooLarge'
  ) {
    return undefined;
  }
  if (failure.status === 403 || failure.status === 404) {
    return 'You may not run this tool.';
  }
  return failureText(failure, 'Could not run the tool.');
}
