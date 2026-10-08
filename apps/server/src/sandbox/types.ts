import { Option, Schema } from 'effect';

// The sandbox worker imports these straight from `./limits` so it never loads
// Effect; they are re-exported here so existing importers stay unchanged.
export {
  DEFAULT_LIMITS,
  FETCH_DENIED_PREFIX,
  HARD_MAX_LIMITS,
  MAX_SOURCE_BYTES,
  resolveLimits,
  withFetchPrefix,
} from './limits';
export type { SandboxLimits } from './limits';

export type SandboxErrorKind =
  | 'invalid_source'
  | 'syntax'
  | 'runtime'
  | 'timeout'
  | 'memory'
  | 'output_too_large'
  | 'invalid_output'
  | 'fetch_denied'
  | 'sandbox_failure';

export interface ToolOutput {
  text: string;
  data?: unknown;
}

export type RunToolResult =
  | {
      ok: true;
      output: ToolOutput;
      logs: string;
      durationMs: number;
      fetchCount: number;
    }
  | {
      ok: false;
      error: { kind: SandboxErrorKind; message: string };
      logs: string;
      durationMs: number;
      fetchCount: number;
    };

const toolOutputSchema = Schema.Struct({
  text: Schema.String,
  data: Schema.optional(Schema.Unknown),
});

export function parseToolOutput(value: unknown, maxBytes: number): ToolOutput | null {
  const parsed = Schema.decodeUnknownOption(toolOutputSchema)(value);
  if (Option.isNone(parsed)) {
    return null;
  }
  const output = parsed.value;
  if (output.text.length > maxBytes) {
    return null;
  }
  return output.data === undefined
    ? { text: output.text }
    : { text: output.text, data: output.data };
}
