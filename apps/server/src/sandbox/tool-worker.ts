import { parentPort, workerData } from 'node:worker_threads';
import { Effect } from 'effect';
import { getQuickJS, type QuickJSHandle } from 'quickjs-emscripten';
import { MAX_SOURCE_BYTES, resolveLimits, type SandboxLimits } from './limits';
import { createFetchBridge } from './tool-worker-fetch';
import {
  createCpuTracker,
  createVmTools,
  disposeQuietly,
  dumpVmError,
  interruptedResult,
  logToParent,
  nextImmediate,
  type WorkerErrorKind,
} from './tool-worker-vm';

// Runs inside the worker thread. It owns the QuickJS runtime for one tool
// execution and talks to the parent only through small JSON messages: log
// lines stream out, fetch requests go out and responses come back in.

interface WorkerParams {
  source: string;
  inputJson: string;
  allowedHosts: string[];
  limits: SandboxLimits;
}

const run = Effect.gen(function* () {
  const params = workerData as WorkerParams;
  const limits = resolveLimits(params.limits);
  const startedAt = Date.now();

  const finish = (
    message:
      | { type: 'result'; outputJson: string; fetchCount: number; durationMs: number }
      | {
          type: 'error';
          kind: WorkerErrorKind;
          message: string;
          fetchCount: number;
          durationMs: number;
        },
  ): void => {
    parentPort?.postMessage(message);
  };

  if (Buffer.byteLength(params.source, 'utf8') > MAX_SOURCE_BYTES) {
    finish({
      type: 'error',
      kind: 'invalid_output',
      message: 'tool source is too large',
      fetchCount: 0,
      durationMs: 0,
    });
    return;
  }

  const QuickJS = yield* Effect.promise(() => getQuickJS());
  const runtime = QuickJS.newRuntime();
  const wallDeadline = startedAt + limits.wallMs;
  let fetchCount = 0;

  const failRun = (kind: WorkerErrorKind, message: string): void => {
    finish({ type: 'error', kind, message, fetchCount, durationMs: Date.now() - startedAt });
  };

  const cpu = createCpuTracker();
  const { enterVm, exitVm, cpuConsumedMs } = cpu;

  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  runtime.setInterruptHandler(() => Date.now() >= wallDeadline || cpuConsumedMs() >= limits.cpuMs);

  const context = runtime.newContext();

  const { pumpJobs, evalInVm, callInVm, handles, track, settleVm, rejectWith } = createVmTools(
    runtime,
    context,
    cpu,
  );

  const execute = Effect.gen(function* () {
    const fetchImpl = createFetchBridge({
      limits,
      context,
      readFetchCount: () => fetchCount,
      addFetch: () => {
        fetchCount += 1;
      },
      track,
      settleVm,
      enterVm,
      exitVm,
      rejectWith,
    });

    const fetchHandle = track(context.newFunction('fetch', fetchImpl));
    context.setProp(context.global, 'fetch', fetchHandle);

    const logImpl = (...args: QuickJSHandle[]): QuickJSHandle => {
      const parts = args.map((arg) => {
        try {
          const dumped: unknown = context.dump(arg);
          return typeof dumped === 'string' ? dumped : (JSON.stringify(dumped) ?? 'undefined');
        } catch {
          return 'undefined';
        }
      });
      logToParent(parts.join(' '));
      return context.undefined;
    };
    const consoleHandle = track(context.newObject());
    for (const level of ['log', 'warn', 'error'] as const) {
      const fn = track(context.newFunction(level, logImpl));
      context.setProp(consoleHandle, level, fn);
    }
    context.setProp(context.global, 'console', consoleHandle);

    context.setProp(context.global, '__zilar_input', track(context.newString(params.inputJson)));

    const evalResult = evalInVm(params.source, true);
    if (evalResult.error) {
      const dumped = dumpVmError(context, evalResult.error);
      evalResult.error.dispose();
      const interrupted = interruptedResult(dumped.message);
      if (interrupted !== null) {
        finish({ ...interrupted, fetchCount, durationMs: Date.now() - startedAt });
        return;
      }
      if (/could not load module/i.test(dumped.message)) {
        failRun('runtime', 'imports are not allowed');
        return;
      }
      failRun('syntax', dumped.message.slice(0, 300));
      return;
    }
    const namespace = evalResult.value;
    track(namespace);
    const defaultExport = track(context.getProp(namespace, 'default'));
    if (context.typeof(defaultExport) !== 'function') {
      failRun('invalid_output', 'tool must default-export a function');
      return;
    }

    const parseInput = evalInVm('JSON.parse(__zilar_input)');
    if (parseInput.error) {
      const dumped = dumpVmError(context, parseInput.error);
      parseInput.error.dispose();
      failRun('runtime', dumped.message.slice(0, 300));
      return;
    }
    const inputHandle = parseInput.value;
    track(inputHandle);

    const callResult = callInVm(defaultExport, context.undefined, [inputHandle]);
    if (callResult.error) {
      const dumped = dumpVmError(context, callResult.error);
      callResult.error.dispose();
      const interrupted = interruptedResult(dumped.message);
      if (interrupted !== null) {
        finish({ ...interrupted, fetchCount, durationMs: Date.now() - startedAt });
        return;
      }
      failRun('runtime', `${dumped.name}: ${dumped.message}`.slice(0, 300));
      return;
    }
    const returned = callResult.value;
    track(returned);

    const asPromise = context.resolvePromise(returned);
    let settled = false;
    Effect.runFork(
      Effect.exit(Effect.promise(() => asPromise)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            settled = true;
          }),
        ),
      ),
    );

    while (!settled) {
      const jobs = pumpJobs();
      if (jobs.error) {
        const dumped = dumpVmError(context, jobs.error);
        jobs.error.dispose();
        failRun('runtime', `${dumped.name}: ${dumped.message}`.slice(0, 300));
        return;
      }
      if (Date.now() >= wallDeadline) {
        failRun('timeout', 'tool timed out');
        return;
      }
      yield* nextImmediate;
    }

    const finalResult = yield* Effect.promise(() => asPromise);
    if (finalResult.error) {
      const dumped = dumpVmError(context, finalResult.error);
      finalResult.error.dispose();
      const interrupted = interruptedResult(dumped.message);
      if (interrupted !== null) {
        finish({ ...interrupted, fetchCount, durationMs: Date.now() - startedAt });
        return;
      }
      if (/^fetch_denied:/i.test(dumped.message)) {
        failRun('fetch_denied', dumped.message.slice(0, 300));
        return;
      }
      failRun('runtime', `${dumped.name}: ${dumped.message}`.slice(0, 300));
      return;
    }

    const valueHandle = finalResult.value;
    track(valueHandle);
    const valueType = context.typeof(valueHandle);
    let outputJson: string | null = null;
    if (valueType === 'string') {
      const text = context.getString(valueHandle);
      outputJson = JSON.stringify({ text });
    } else if (valueType === 'object') {
      context.setProp(context.global, '__zilar_result_value', valueHandle);
      const stringifyResult = evalInVm(
        '(() => { try { return JSON.stringify(__zilar_result_value); } catch (e) { return null; } })()',
      );
      if (!stringifyResult.error) {
        const stringified = stringifyResult.value;
        track(stringified);
        if (context.typeof(stringified) === 'string') {
          outputJson = context.getString(stringified);
        }
      } else {
        stringifyResult.error.dispose();
      }
    }
    if (outputJson === null) {
      failRun('invalid_output', 'tool must return a string or { text, data }');
      return;
    }
    if (Buffer.byteLength(outputJson, 'utf8') > limits.maxOutputBytes) {
      failRun('output_too_large', 'tool output is too large');
      return;
    }
    finish({ type: 'result', outputJson, fetchCount, durationMs: Date.now() - startedAt });
  });

  // A failed dispose stops the handle loop; the context and runtime are still
  // disposed. The runtime may be out of memory; the worker exits anyway.
  const disposeVm = Effect.gen(function* () {
    for (let index = handles.length - 1; index >= 0; index -= 1) {
      const handle = handles[index] as QuickJSHandle;
      const disposed = yield* disposeQuietly(() => {
        if (handle.alive) {
          handle.dispose();
        }
      });
      if (!disposed) {
        break;
      }
    }
    yield* disposeQuietly(() => context.dispose());
    yield* disposeQuietly(() => runtime.dispose());
  });

  yield* execute.pipe(
    Effect.catchCause(() =>
      Effect.sync(() => {
        failRun('runtime', 'tool failed');
      }),
    ),
    Effect.ensuring(disposeVm),
  );
});

void Effect.runPromise(run);
