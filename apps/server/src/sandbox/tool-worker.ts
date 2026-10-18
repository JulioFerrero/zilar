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

// QuickJS has no `Intl`, so tools cannot rely on `toLocaleString` for rounding or
// grouping. This source runs once in the VM before the tool and installs a frozen
// `fmt`; keep it small, since it runs under the tool's own limits.
const TOOL_PRELUDE = `
globalThis.fmt = Object.freeze((() => {
  const DASH = '\u2014';
  const group = (digits) => {
    let out = '';
    let count = 0;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      out = digits[i] + out;
      count += 1;
      if (count % 3 === 0 && i > 0) out = ',' + out;
    }
    return out;
  };
  const round = (value, digits) => {
    if (typeof value !== 'number' || !isFinite(value)) return null;
    const places = Math.max(0, Math.min(20, Math.floor(digits)));
    return value.toFixed(places);
  };
  const grouped = (fixed) => {
    const negative = fixed.charAt(0) === '-';
    const body = negative ? fixed.slice(1) : fixed;
    const dot = body.indexOf('.');
    const whole = dot === -1 ? body : body.slice(0, dot);
    const fraction = dot === -1 ? '' : body.slice(dot);
    return (negative ? '-' : '') + group(whole) + fraction;
  };
  const number = (value, digits = 2) => {
    const fixed = round(value, digits);
    return fixed === null ? DASH : grouped(fixed);
  };
  const money = (value, symbol = '$', digits = 2) => {
    const fixed = round(value, digits);
    return fixed === null ? DASH : symbol + grouped(fixed);
  };
  const change = (now, before, digits = 1) => {
    const fixed = round(((now - before) / before) * 100, digits);
    if (fixed === null) return { direction: 'flat', text: DASH };
    const rounded = Number(fixed);
    const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
    return { direction, text: number(Math.abs(rounded), digits) + '%' };
  };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const pad = (value) => (value < 10 ? '0' : '') + value;
  const toDate = (value) => {
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return isFinite(parsed) ? new Date(parsed) : null;
    }
    if (typeof value === 'number' && isFinite(value)) return new Date(value);
    return null;
  };
  const date = (value) => {
    const at = toDate(value);
    if (at === null) return DASH;
    return DAYS[at.getUTCDay()] + ' ' + at.getUTCDate() + ' ' + MONTHS[at.getUTCMonth()];
  };
  const time = (value, offsetMinutes = 0) => {
    const at = toDate(value);
    if (at === null || typeof offsetMinutes !== 'number' || !isFinite(offsetMinutes)) return DASH;
    const shifted = new Date(at.getTime() + offsetMinutes * 60000);
    return pad(shifted.getUTCHours()) + ':' + pad(shifted.getUTCMinutes());
  };
  const ago = (value, now = Date.now()) => {
    const at = toDate(value);
    if (at === null || typeof now !== 'number' || !isFinite(now)) return DASH;
    const diff = now - at.getTime();
    if (diff < 60000) return 'just now';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return minutes + ' min ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' h ago';
    return Math.floor(hours / 24) + ' d ago';
  };
  const duration = (ms) => {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return DASH;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return seconds + ' s';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + ' min';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? hours + ' h' : hours + ' h ' + rest + ' min';
  };
  return { number, money, change, date, time, ago, duration };
})());
`;
// Owns the QuickJS runtime for one tool execution. It talks to the parent only
// through small JSON messages: logs out, fetch requests out and responses in.

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

    // QuickJS has no `Intl`, so install `fmt` before the tool runs.
    const preludeResult = evalInVm(TOOL_PRELUDE);
    if (preludeResult.error) {
      const dumped = dumpVmError(context, preludeResult.error);
      preludeResult.error.dispose();
      failRun('runtime', dumped.message.slice(0, 300));
      return;
    }
    preludeResult.value.dispose();

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
  // disposed, since the runtime may be out of memory.
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
