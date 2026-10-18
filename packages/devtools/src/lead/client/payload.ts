import { Result, Schema } from 'effect';

export const sessionIdSchema = Schema.Struct({ id: Schema.String });

const envelopeSchema = Schema.Struct({ data: Schema.Unknown });

// The raw OpenCode payloads vary by version, so they stay `unknown` and the decision
// layer reads them defensively; `data` is the envelope every call returns.
export function readDataPayload(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  const envelope = Schema.decodeUnknownResult(envelopeSchema)(parsed);
  if (Result.isFailure(envelope)) {
    throw new Error('opencode2 response has no data envelope');
  }
  return envelope.success.data;
}
