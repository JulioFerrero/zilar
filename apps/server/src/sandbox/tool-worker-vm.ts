import { parentPort } from 'node:worker_threads';
import { Effect } from 'effect';
import type { QuickJSContext, QuickJSHandle, QuickJSRuntime } from 'quickjs-emscripten';

// VM-side helpers for the sandbox worker: dumping VM errors, streaming logs to
// the parent and the CPU-accounted entry points into QuickJS. They take the
// runtime and the context as parameters, so `tool-worker.ts` keeps only the
// control flow.

export type WorkerErrorKind =
  | 'timeout'
  | 'memory'
  | 'runtime'
  | 'syntax'
  | 'invalid_output'
  | 'fetch_denied'
  | 'output_too_large';

export function dumpVmError(
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

export function logToParent(text: string): void {
  parentPort?.postMessage({ type: 'log', text });
}

// One macrotask turn, so fetch results and timers can run between job pumps.
export const nextImmediate: Effect.Effect<void> = Effect.callback<void>((resume) => {
  const handle = setImmediate(() => {
    resume(Effect.void);
  });
  return Effect.sync(() => {
    clearImmediate(handle);
  });
});

export const disposeQuietly = (dispose: () => void): Effect.Effect<boolean> =>
  Effect.match(Effect.try(dispose), { onFailure: () => false, onSuccess: () => true });

export function interruptedResult(
  text: string,
): { type: 'error'; kind: WorkerErrorKind; message: string } | null {
  if (/interrupted/i.test(text)) {
    return { type: 'error', kind: 'timeout', message: 'tool timed out' };
  }
  if (/out of memory/i.test(text)) {
    return { type: 'error', kind: 'memory', message: 'tool ran out of memory' };
  }
  return null;
}

// cpuMs counts only time the VM is actually executing JS, never time spent
// waiting on fetch. Every entry into the VM (evalCode, callFunction,
// executePendingJobs) opens a segment; leaving closes it and accumulates. The
// depth counter keeps nested entries (evalCode inside a host function) from
// corrupting the total.
export function createCpuTracker() {
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
  return { enterVm, exitVm, cpuConsumedMs };
}

type CpuTracker = ReturnType<typeof createCpuTracker>;

// All VM entries go through these so cpu accounting stays complete. Never call
// runtime.executePendingJobs() from inside a host function (text, json, fetch):
// that would pump jobs re-entrantly from inside VM execution. The main loop
// already pumps after every return.
export function createVmTools(runtime: QuickJSRuntime, context: QuickJSContext, cpu: CpuTracker) {
  const { enterVm, exitVm } = cpu;

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

  return { pumpJobs, evalInVm, callInVm, handles, track, settleVm, rejectWith };
}
