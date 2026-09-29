import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten';
import type { FetchResponse } from './host-fetch';
import { MAX_SOURCE_BYTES, resolveLimits, withFetchPrefix, type SandboxLimits } from './types';

// Runs inside the worker thread. It owns the QuickJS runtime for one tool
// execution and talks to the parent only through small JSON messages: log
// lines stream out, fetch requests go out and responses come back in.

interface WorkerParams {
  source: string;
  inputJson: string;
  allowedHosts: string[];
  limits: SandboxLimits;
}

interface WorkerFetchPayload {
  id: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyPresent: boolean;
}

type WorkerErrorKind =
  | 'timeout'
  | 'memory'
  | 'runtime'
  | 'syntax'
  | 'invalid_output'
  | 'fetch_denied'
  | 'output_too_large';

function dumpVmError(
  ctx: QuickJSContext,
  errorHandle: QuickJSHandle,
): { name: string; message: string } {
  try {
    const dumped: unknown = ctx.dump(errorHandle);
    if (typeof dumped === 'object' && dumped !== null) {
      const record = dumped as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name : 'Error';
      const message = typeof record.message === 'string' ? record.message : 'tool failed';
      return { name, message };
    }
    return { name: 'Error', message: String(dumped).slice(0, 300) };
  } catch {
    return { name: 'Error', message: 'tool failed' };
  }
}

function logToParent(text: string): void {
  parentPort?.postMessage({ type: 'log', text });
}

function waitForFetchResponse(id: number, fetchTimeoutMs: number): Promise<FetchResponse> {
  return new Promise<FetchResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      parentPort?.off('message', onMessage);
      reject(new Error('fetch timeout'));
    }, fetchTimeoutMs + 1000);
    const onMessage = (message: unknown): void => {
      if (typeof message !== 'object' || message === null) {
        return;
      }
      const record = message as Record<string, unknown>;
      if (record.type !== 'fetch-result' || record.id !== id) {
        return;
      }
      clearTimeout(timer);
      parentPort?.off('message', onMessage);
      if (record.ok === true) {
        const body = record.body;
        resolve({
          status: typeof record.status === 'number' ? record.status : 0,
          body: body instanceof Uint8Array ? body : new Uint8Array(0),
        });
        return;
      }
      reject(new Error(typeof record.message === 'string' ? record.message : 'fetch failed'));
    };
    parentPort?.on('message', onMessage);
  });
}

async function run(): Promise<void> {
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

  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  const wallDeadline = startedAt + limits.wallMs;
  let fetchCount = 0;

  // cpuMs counts only time the VM is actually executing JS, never time
  // spent waiting on fetch. Every entry into the VM (evalCode,
  // callFunction, executePendingJobs) opens a segment; leaving closes it
  // and accumulates. The depth counter keeps nested entries (evalCode
  // inside a host function) from corrupting the total.
  let cpuUsedMs = 0;
  let vmDepth = 0;
  let segmentStartMs = 0;
  const enterVm = (): void => {
    if (vmDepth === 0) {
      segmentStartMs = Date.now();
    }
    vmDepth += 1;
  };
  const exitVm = (): void => {
    vmDepth -= 1;
    if (vmDepth === 0) {
      cpuUsedMs += Date.now() - segmentStartMs;
    }
  };
  const cpuConsumedMs = (): number => cpuUsedMs + (vmDepth > 0 ? Date.now() - segmentStartMs : 0);

  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  runtime.setInterruptHandler(() => Date.now() >= wallDeadline || cpuConsumedMs() >= limits.cpuMs);

  const context = runtime.newContext();

  // All VM entries go through these so cpu accounting stays complete.
  // Never call runtime.executePendingJobs() from inside a host function
  // (text, json, fetch): that would pump jobs re-entrantly from inside VM
  // execution. The main loop below already pumps after every return.
  const pumpJobs = () => {
    enterVm();
    try {
      return runtime.executePendingJobs();
    } finally {
      exitVm();
    }
  };
  const evalInVm = (code: string, asModule = false) => {
    enterVm();
    try {
      return asModule
        ? context.evalCode(code, 'tool.js', { type: 'module' })
        : context.evalCode(code, 'tool.js');
    } finally {
      exitVm();
    }
  };
  const callInVm = (func: QuickJSHandle, thisVal: QuickJSHandle, args: QuickJSHandle[]) => {
    enterVm();
    try {
      return context.callFunction(func, thisVal, args);
    } finally {
      exitVm();
    }
  };
  const handles: QuickJSHandle[] = [];
  const track = (handle: QuickJSHandle): QuickJSHandle => {
    handles.push(handle);
    return handle;
  };
  // Pumps that run outside VM execution (async fetch continuation, error
  // paths) go through settleVm, so the VM time they spend also counts as cpu.
  const settleVm = (settle: (handle: QuickJSHandle) => void, handle: QuickJSHandle): void => {
    enterVm();
    try {
      settle(handle);
    } finally {
      exitVm();
    }
    pumpJobs();
  };
  const rejectWith = (
    deferred: { reject: (handle: QuickJSHandle) => void },
    text: string,
  ): void => {
    settleVm((handle) => deferred.reject(handle), track(context.newString(text)));
  };

  try {
    let fetchId = 0;

    const fetchImpl = (urlHandle: QuickJSHandle, initHandle?: QuickJSHandle): QuickJSHandle => {
      const deferred = context.newPromise();
      let urlText = '';
      try {
        urlText = context.getString(urlHandle);
      } catch {
        rejectWith(deferred, 'fetch_denied: invalid url');
        return deferred.handle;
      }
      void (async () => {
        try {
          if (fetchCount >= limits.maxFetches) {
            rejectWith(deferred, 'fetch_denied: too many fetches');
            return;
          }
          fetchCount += 1;
          let method = 'GET';
          let headers: Record<string, string> = {};
          let bodyPresent = false;
          if (initHandle !== undefined) {
            try {
              if (context.typeof(initHandle) !== 'undefined') {
                const dumpedInit: unknown = context.dump(initHandle);
                if (typeof dumpedInit === 'object' && dumpedInit !== null) {
                  const init = dumpedInit as Record<string, unknown>;
                  if (typeof init.method === 'string') {
                    method = init.method;
                  }
                  if (typeof init.body !== 'undefined' && init.body !== null) {
                    bodyPresent = true;
                  }
                  if (typeof init.headers === 'object' && init.headers !== null) {
                    const rawHeaders = init.headers as Record<string, unknown>;
                    for (const [name, value] of Object.entries(rawHeaders)) {
                      if (typeof value === 'string') {
                        headers[name.toLowerCase()] = value;
                      }
                    }
                  }
                }
              }
            } catch {
              headers = {};
            }
          }
          const id = fetchId++;
          const payload: WorkerFetchPayload = { id, url: urlText, method, headers, bodyPresent };
          parentPort?.postMessage({ type: 'fetch', ...payload });
          const response = await waitForFetchResponse(id, limits.fetchTimeoutMs);
          const bodyBytes = response.body;
          const bodyText = Buffer.from(bodyBytes).toString('utf8');
          const responseHandle = track(context.newObject());
          context.setProp(
            responseHandle,
            'ok',
            track(response.status >= 200 && response.status < 300 ? context.true : context.false),
          );
          context.setProp(responseHandle, 'status', track(context.newNumber(response.status)));
          const textFn = track(
            context.newFunction('text', () => {
              const out = context.newPromise();
              out.resolve(track(context.newString(bodyText)));
              return out.handle;
            }),
          );
          context.setProp(responseHandle, 'text', textFn);
          const jsonFn = track(
            context.newFunction('json', () => {
              const out = context.newPromise();
              enterVm();
              try {
                context.setProp(
                  context.global,
                  '__galena_body',
                  track(context.newString(bodyText)),
                );
                const parsed = context.evalCode('JSON.parse(__galena_body)', 'tool.js');
                if (parsed.error) {
                  parsed.error.dispose();
                  out.reject(track(context.newString('invalid json')));
                } else {
                  const value = parsed.value;
                  track(value);
                  out.resolve(value);
                }
              } finally {
                exitVm();
              }
              return out.handle;
            }),
          );
          context.setProp(responseHandle, 'json', jsonFn);
          settleVm((handle) => deferred.resolve(handle), responseHandle);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'fetch failed';
          rejectWith(deferred, withFetchPrefix(message));
        }
      })();
      return deferred.handle;
    };

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

    context.setProp(context.global, '__galena_input', track(context.newString(params.inputJson)));

    const interruptedResult = (
      text: string,
    ): { type: 'error'; kind: WorkerErrorKind; message: string } | null => {
      if (/interrupted/i.test(text)) {
        return { type: 'error', kind: 'timeout', message: 'tool timed out' };
      }
      if (/out of memory/i.test(text)) {
        return { type: 'error', kind: 'memory', message: 'tool ran out of memory' };
      }
      return null;
    };

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
        finish({
          type: 'error',
          kind: 'runtime',
          message: 'imports are not allowed',
          fetchCount,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      finish({
        type: 'error',
        kind: 'syntax',
        message: dumped.message.slice(0, 300),
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    const namespace = evalResult.value;
    track(namespace);
    const defaultExport = track(context.getProp(namespace, 'default'));
    if (context.typeof(defaultExport) !== 'function') {
      finish({
        type: 'error',
        kind: 'invalid_output',
        message: 'tool must default-export a function',
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const parseInput = evalInVm('JSON.parse(__galena_input)');
    if (parseInput.error) {
      const dumped = dumpVmError(context, parseInput.error);
      parseInput.error.dispose();
      finish({
        type: 'error',
        kind: 'runtime',
        message: dumped.message.slice(0, 300),
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
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
      finish({
        type: 'error',
        kind: 'runtime',
        message: `${dumped.name}: ${dumped.message}`.slice(0, 300),
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    const returned = callResult.value;
    track(returned);

    const asPromise = context.resolvePromise(returned);
    let settled = false;
    asPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    while (!settled) {
      const jobs = pumpJobs();
      if (jobs.error) {
        const dumped = dumpVmError(context, jobs.error);
        jobs.error.dispose();
        finish({
          type: 'error',
          kind: 'runtime',
          message: `${dumped.name}: ${dumped.message}`.slice(0, 300),
          fetchCount,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      if (Date.now() >= wallDeadline) {
        finish({
          type: 'error',
          kind: 'timeout',
          message: 'tool timed out',
          fetchCount,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }

    const finalResult = await asPromise;
    if (finalResult.error) {
      const dumped = dumpVmError(context, finalResult.error);
      finalResult.error.dispose();
      const interrupted = interruptedResult(dumped.message);
      if (interrupted !== null) {
        finish({ ...interrupted, fetchCount, durationMs: Date.now() - startedAt });
        return;
      }
      if (/^fetch_denied:/i.test(dumped.message)) {
        finish({
          type: 'error',
          kind: 'fetch_denied',
          message: dumped.message.slice(0, 300),
          fetchCount,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      finish({
        type: 'error',
        kind: 'runtime',
        message: `${dumped.name}: ${dumped.message}`.slice(0, 300),
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
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
      context.setProp(context.global, '__galena_result_value', valueHandle);
      const stringifyResult = evalInVm(
        '(() => { try { return JSON.stringify(__galena_result_value); } catch (e) { return null; } })()',
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
      finish({
        type: 'error',
        kind: 'invalid_output',
        message: 'tool must return a string or { text, data }',
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    if (Buffer.byteLength(outputJson, 'utf8') > limits.maxOutputBytes) {
      finish({
        type: 'error',
        kind: 'output_too_large',
        message: 'tool output is too large',
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    finish({ type: 'result', outputJson, fetchCount, durationMs: Date.now() - startedAt });
  } catch {
    parentPort?.postMessage({
      type: 'error',
      kind: 'runtime',
      message: 'tool failed',
      fetchCount,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    for (let index = handles.length - 1; index >= 0; index -= 1) {
      const handle = handles[index] as QuickJSHandle;
      try {
        if (handle.alive) {
          handle.dispose();
        }
      } catch {
        break;
      }
    }
    try {
      context.dispose();
    } catch {
      // The runtime may be out of memory; the worker exits anyway.
    }
    try {
      runtime.dispose();
    } catch {
      // Same as above.
    }
  }
}

void run();
