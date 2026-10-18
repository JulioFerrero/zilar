import { Option, Schema } from 'effect';

import { ToolsApiError } from '@/lib/tools-api';

const RunInputJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** The biggest run input the client sends, in bytes of UTF-8 (like web). */
export const MAX_RUN_INPUT_BYTES = 4 * 1024;

export const RUN_INPUT_INVALID_MESSAGE = 'Input must be valid JSON.';

export const RUN_INPUT_TOO_BIG_MESSAGE = 'Input must be at most 4 KB.';

export const RUN_FORBIDDEN_MESSAGE = 'You may not run this tool.';

export const RUN_RATE_LIMITED_MESSAGE = 'Too many runs. Try again in a minute.';

export const RUN_UNAVAILABLE_MESSAGE = 'Tools cannot run on this server yet.';

export const RUN_FAILED_MESSAGE = 'Could not run the tool. Try again.';

export const CHANGE_FORBIDDEN_MESSAGE = 'You may not change this tool.';

export const REVERT_FAILED_MESSAGE = 'Could not revert the tool. Try again.';

export const DELETE_FAILED_MESSAGE = 'Could not delete the tool. Try again.';

export type RunInputParse = { ok: true; input?: unknown } | { ok: false; message: string };

/** Empty input sends no `input`; invalid JSON and input over 4 KB of UTF-8 are fixed lines. */
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

/** The tool's own failed result (`ok: false`) is data, not an error, and passes through. */
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

/** 403/404 is the forbidden line, anything else (including network errors) is the fallback. Never the server text. */
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
