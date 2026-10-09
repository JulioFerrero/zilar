import { Option, Schema } from 'effect';

import { ToolsApiError } from '@/lib/tools-api';

/** Decodes the run input text as JSON; a failed decode is `None`, never a throw. */
const RunInputJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** The biggest run input the client sends, in bytes of UTF-8 (like web). */
export const MAX_RUN_INPUT_BYTES = 4 * 1024;

/** Fixed user-facing line when the run input is not JSON. */
export const RUN_INPUT_INVALID_MESSAGE = 'Input must be valid JSON.';

/** Fixed user-facing line when the run input is bigger than 4 KB. */
export const RUN_INPUT_TOO_BIG_MESSAGE = 'Input must be at most 4 KB.';

/** Fixed user-facing line when the server refuses the run. */
export const RUN_FORBIDDEN_MESSAGE = 'You may not run this tool.';

/** Fixed user-facing line when the server is rate-limiting runs. */
export const RUN_RATE_LIMITED_MESSAGE = 'Too many runs. Try again in a minute.';

/** Fixed user-facing line when the server cannot run tools yet. */
export const RUN_UNAVAILABLE_MESSAGE = 'Tools cannot run on this server yet.';

/** Fixed user-facing line for any other run failure. Never server text. */
export const RUN_FAILED_MESSAGE = 'Could not run the tool. Try again.';

/** Fixed user-facing line when the server refuses the revert or delete. */
export const CHANGE_FORBIDDEN_MESSAGE = 'You may not change this tool.';

/** Fixed user-facing line for any other revert failure. Never server text. */
export const REVERT_FAILED_MESSAGE = 'Could not revert the tool. Try again.';

/** Fixed user-facing line for any other delete failure. Never server text. */
export const DELETE_FAILED_MESSAGE = 'Could not delete the tool. Try again.';

export type RunInputParse = { ok: true; input?: unknown } | { ok: false; message: string };

/**
 * Parses the Run now input before the request (like web's `run` in
 * `ToolDetailPanel.tsx`): empty input sends no `input`, invalid JSON and
 * input bigger than 4 KB of UTF-8 are fixed lines.
 */
export function parseRunInput(text: string): RunInputParse {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: true };
  }
  const parsed = RunInputJson(trimmed);
  if (Option.isNone(parsed)) {
    return { ok: false, message: RUN_INPUT_INVALID_MESSAGE };
  }
  if (new TextEncoder().encode(trimmed).length > MAX_RUN_INPUT_BYTES) {
    return { ok: false, message: RUN_INPUT_TOO_BIG_MESSAGE };
  }
  return { ok: true, input: parsed.value };
}

/**
 * Maps a run request failure to the fixed user-facing line. The tool's own
 * failed result (`ok: false`) is data, not an error, and passes through.
 */
export function runErrorMessage(error: unknown): string {
  if (error instanceof ToolsApiError && error.status === 429) {
    return RUN_RATE_LIMITED_MESSAGE;
  }
  if (error instanceof ToolsApiError && (error.status === 403 || error.status === 404)) {
    return RUN_FORBIDDEN_MESSAGE;
  }
  if (error instanceof ToolsApiError && error.status === 501) {
    return RUN_UNAVAILABLE_MESSAGE;
  }
  return RUN_FAILED_MESSAGE;
}

/**
 * Maps a revert or delete failure to the fixed user-facing line: 403/404
 * is the forbidden line, anything else (including network errors) is the
 * fallback. Never the server text.
 */
export function changeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ToolsApiError && (error.status === 403 || error.status === 404)) {
    return CHANGE_FORBIDDEN_MESSAGE;
  }
  return fallback;
}

/** `1 fetch` / `2 fetches`, like web's `RunResultBlock`. */
export function fetchCountText(count: number): string {
  return `${count} ${count === 1 ? 'fetch' : 'fetches'}`;
}
