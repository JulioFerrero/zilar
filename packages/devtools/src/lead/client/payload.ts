import { Result, Schema } from 'effect';

export const sessionIdSchema = Schema.Struct({ id: Schema.String });

const envelopeSchema = Schema.Struct({ data: Schema.Unknown });

// The raw OpenCode message/permission payloads vary by version, so the client
// keeps them as unknown and the decision layer reads them defensively.
// `data` is the envelope every `opencode2 api` call returns.
export function readDataPayload(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  const envelope = Schema.decodeUnknownResult(envelopeSchema)(parsed);
  if (Result.isFailure(envelope)) {
    throw new Error('opencode2 response has no data envelope');
  }
  // The payload lives in the envelope's `data` property.
  return envelope.success.data;
}
