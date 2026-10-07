import { Cause, Effect, References } from 'effect';
import { pino, type Logger as PinoLogger } from 'pino';
import { describe, expect, it } from 'vitest';
import { redactPaths } from '../logger';
import { makePinoLoggerLayer } from './logger';

function memoryPino(): { logger: PinoLogger; text: () => string } {
  const chunks: string[] = [];
  const logger = pino(
    { level: 'trace', redact: { paths: redactPaths, censor: '[redacted]' } },
    {
      write: (line: string): void => {
        chunks.push(line);
      },
    },
  );

  return { logger, text: () => chunks.join('') };
}

describe('makePinoLoggerLayer', () => {
  it('forwards Effect.log with annotations to pino', async () => {
    const { logger, text } = memoryPino();

    await Effect.runPromise(
      Effect.log('hello world').pipe(
        Effect.annotateLogs({ requestId: 'req-1' }),
        Effect.provide(makePinoLoggerLayer(logger)),
      ),
    );

    const entry = JSON.parse(text().trim()) as {
      msg: string;
      level: number;
      requestId: string;
    };

    expect(entry.msg).toBe('hello world');
    expect(entry.level).toBe(30);
    expect(entry.requestId).toBe('req-1');
  });

  it('forwards logWarning and logError at the matching pino level', async () => {
    const { logger, text } = memoryPino();

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.logWarning('careful').pipe(Effect.annotateLogs({ scope: 'warn-test' }));
        yield* Effect.logError('boom').pipe(Effect.annotateLogs({ scope: 'error-test' }));
      }).pipe(Effect.provide(makePinoLoggerLayer(logger))),
    );

    const entries = text()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { msg: string; level: number; scope: string });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ msg: 'careful', level: 40, scope: 'warn-test' });
    expect(entries[1]).toMatchObject({ msg: 'boom', level: 50, scope: 'error-test' });
  });

  it('maps every Effect level to the matching pino method', async () => {
    const { logger, text } = memoryPino();

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.logTrace('trace-line');
        yield* Effect.logDebug('debug-line');
        yield* Effect.logInfo('info-line');
        yield* Effect.logWarning('warn-line');
        yield* Effect.logError('error-line');
        yield* Effect.logFatal('fatal-line');
      }).pipe(
        Effect.provide(makePinoLoggerLayer(logger)),
        Effect.provideService(References.MinimumLogLevel, 'Trace'),
      ),
    );

    const entries = text()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { msg: string; level: number });

    expect(entries.map((entry) => [entry.msg, entry.level])).toEqual([
      ['trace-line', 10],
      ['debug-line', 20],
      ['info-line', 30],
      ['warn-line', 40],
      ['error-line', 50],
      ['fatal-line', 60],
    ]);
  });

  it('redacts sensitive annotations through the pino instance', async () => {
    const { logger, text } = memoryPino();

    await Effect.runPromise(
      Effect.log('login attempt').pipe(
        Effect.annotateLogs({
          token: 'super-secret-token-value',
          DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/zilar',
        }),
        Effect.provide(makePinoLoggerLayer(logger)),
      ),
    );

    const output = text();
    expect(output).not.toContain('super-secret-token-value');
    expect(output).not.toContain('hunter2');
    expect(output).toContain('[redacted]');
  });

  it('turns an object message into redactable fields', async () => {
    const { logger, text } = memoryPino();

    await Effect.runPromise(
      Effect.log({ password: 'hunter2' }).pipe(Effect.provide(makePinoLoggerLayer(logger))),
    );

    const output = text();
    const entry = JSON.parse(output.trim()) as { msg: string; password: string };

    expect(entry.msg).toBe('');
    expect(entry.password).toBe('[redacted]');
    expect(output).not.toContain('hunter2');
  });

  it('keeps string parts as the message and redacts object parts', async () => {
    const { logger, text } = memoryPino();

    await Effect.runPromise(
      Effect.log('saved', { token: 'abc' }).pipe(Effect.provide(makePinoLoggerLayer(logger))),
    );

    const output = text();
    const entry = JSON.parse(output.trim()) as { msg: string; token: string };

    expect(entry.msg).toBe('saved');
    expect(entry.token).toBe('[redacted]');
    expect(output).not.toContain('abc');
  });

  it('renders a cause as an err field with the error name and message', async () => {
    const { logger, text } = memoryPino();

    await Effect.runPromise(
      Effect.logError('failed', Cause.fail(new TypeError('bad input'))).pipe(
        Effect.provide(makePinoLoggerLayer(logger)),
      ),
    );

    const entry = JSON.parse(text().trim()) as {
      msg: string;
      err: { name: string; message: string };
    };

    expect(entry.msg).toBe('failed');
    expect(entry.err).toMatchObject({ name: 'TypeError', message: 'bad input' });
  });

  it('turns an Error message part into an err field', async () => {
    const { logger, text } = memoryPino();

    await Effect.runPromise(
      Effect.logError('save failed', new TypeError('bad input')).pipe(
        Effect.provide(makePinoLoggerLayer(logger)),
      ),
    );

    const entry = JSON.parse(text().trim()) as {
      msg: string;
      err: { name: string; message: string };
    };

    expect(entry.msg).toBe('save failed');
    expect(entry.err).toMatchObject({ name: 'TypeError', message: 'bad input' });
  });

  it('turns a lone Error message into a non-empty err field', async () => {
    const { logger, text } = memoryPino();

    await Effect.runPromise(
      Effect.log(new Error('x')).pipe(Effect.provide(makePinoLoggerLayer(logger))),
    );

    const entry = JSON.parse(text().trim()) as {
      msg: string;
      err?: { name: string; message: string };
    };

    expect(entry.err).toMatchObject({ name: 'Error', message: 'x' });
  });

  it('does not defect on a BigInt message part', async () => {
    const { logger, text } = memoryPino();

    await Effect.runPromise(
      Effect.log('big', 10n).pipe(Effect.provide(makePinoLoggerLayer(logger))),
    );

    const entry = JSON.parse(text().trim()) as { msg: string };
    expect(entry.msg).toBe('big 10');
  });

  it('does not defect on a circular message part', async () => {
    const { logger, text } = memoryPino();
    const circular: Record<string, unknown> = { label: 'round' };
    circular.self = circular;

    await Effect.runPromise(
      Effect.log('circular', circular).pipe(Effect.provide(makePinoLoggerLayer(logger))),
    );

    const entry = JSON.parse(text().trim()) as { msg: string; label: string };
    expect(entry.msg).toBe('circular');
    expect(entry.label).toBe('round');
  });
});
