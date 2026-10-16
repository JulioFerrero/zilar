import { Schema } from 'effect';

export const nonNegativeInt = Schema.Finite.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
);

export const workerResultSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('result'),
    outputJson: Schema.String,
    fetchCount: nonNegativeInt,
    durationMs: Schema.Finite,
  }),
  Schema.Struct({
    type: Schema.Literal('error'),
    kind: Schema.Literals([
      'timeout',
      'memory',
      'runtime',
      'syntax',
      'invalid_output',
      'fetch_denied',
      'output_too_large',
    ]),
    message: Schema.String,
    fetchCount: nonNegativeInt,
    durationMs: Schema.Finite,
  }),
]);

export const workerEventSchema = Schema.Union([
  workerResultSchema,
  Schema.Struct({ type: Schema.Literal('log'), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('fetch'),
    id: nonNegativeInt,
    url: Schema.String,
    method: Schema.String,
    headers: Schema.Record(Schema.String, Schema.String),
    bodyPresent: Schema.Boolean,
  }),
]);

export const outputJsonSchema = Schema.Struct({
  text: Schema.String,
  data: Schema.optional(Schema.Unknown),
});

export function sanitizeMessage(message: string): string {
  return message
    .replace(/[A-Z]:[\\/][^\s]*/g, '[path]')
    .replace(/\/(?:app|home|Users)[^\s]*/g, '[path]')
    .replace(/node_modules[^\s]*/g, '[lib]')
    .replace(/wasm[^:\s]*:\d+/g, '[vm]')
    .replace(/\s+at\s+[^\n]*/g, '')
    .trim()
    .slice(0, 300);
}
