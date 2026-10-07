// Bridges Effect log calls to our pino instance.
//
// The pino instance is built by `createLogger` (../logger.ts), so its own
// `redactPaths` apply to everything this layer emits. Object message parts,
// annotations and spans are placed at the top level of the pino object so those
// redaction paths match: a field named `token` or `DATABASE_URL` is censored by
// pino, not by a second copy of the list. Only string parts become `msg`.
import { Cause, Layer, Logger, Predicate, References, type LogLevel } from 'effect';
import type { Logger as PinoLogger } from 'pino';

type PinoLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// pino's `Logger` varies by custom-level generics; every instance still has the
// six base level methods, so accept just those.
type PinoSink = Pick<PinoLogger, PinoLevel>;

// Exhaustive over `LogLevel.LogLevel`: a level missing here fails typecheck
// rather than silently falling back to `info`.
const PINO_LEVELS: Record<LogLevel.LogLevel, PinoLevel> = {
  All: 'info',
  Fatal: 'fatal',
  Error: 'error',
  Warn: 'warn',
  Info: 'info',
  Debug: 'debug',
  Trace: 'trace',
  None: 'info',
};

function safeStringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function describeCause(cause: Cause.Cause<unknown>): { name: string; message: string } {
  const error = Cause.squash(cause);
  if (error instanceof Error) {
    return { name: error.name, message: safeStringify(error.message) };
  }
  return { name: typeof error, message: safeStringify(error) };
}

export function makePinoLoggerLayer(pinoLogger: PinoSink): Layer.Layer<never> {
  const forwardToPino = Logger.make<unknown, void>((options) => {
    const parts = Array.isArray(options.message) ? options.message : [options.message];
    const messageText: string[] = [];
    const messageFields: Record<string, unknown> = {};
    let messageError: { name: string; message: string } | undefined;

    for (const part of parts) {
      if (typeof part === 'string') {
        messageText.push(part);
      } else if (part instanceof Error) {
        // Only name and message: never the stack or arbitrary enumerable
        // props, which can carry secrets. Keep the first Error part.
        messageError ??= { name: part.name, message: part.message };
      } else if (Predicate.isObject(part)) {
        Object.assign(messageFields, part);
      } else {
        messageText.push(safeStringify(part));
      }
    }

    const spans: Record<string, number> = {};
    const now = options.date.getTime();
    for (const [label, timestamp] of options.fiber.getRef(References.CurrentLogSpans)) {
      spans[label] = now - timestamp;
    }

    const fields: Record<string, unknown> = {
      ...options.fiber.getRef(References.CurrentLogAnnotations),
      ...spans,
      ...messageFields,
    };

    if (messageError !== undefined) {
      fields.err = messageError;
    } else if (options.cause.reasons.length > 0) {
      fields.err = describeCause(options.cause);
    }

    pinoLogger[PINO_LEVELS[options.logLevel]](fields, messageText.join(' '));
  });

  return Logger.layer([forwardToPino]);
}
