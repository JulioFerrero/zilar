import { vi } from 'vitest';

// The one place tests wait for async work. A test that waits "one tick" for a
// visible state is flaky on a busy CI box: wait for the state with `waitFor`
// (or `findBy*`) instead. Raw `setTimeout(resolve, 0)` waits in test files are
// banned by `src/test/noRawTimeoutWaits.test.ts`.

const POLL_MS = 10;

// Lets pending promise callbacks run. A few rounds, because one resolved
// promise often schedules the next one.
export async function flushMicrotasks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

// Lets zero-delay timers and the promise chains they start run: a few
// macrotask turns. Under fake timers it advances the fake clock by 0 ms.
export async function flushTasks(turns = 2): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0);
    } else {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }
}

// Polls `check` until it stops throwing and does not return `false`. Works
// with real and fake timers: under `vi.useFakeTimers()` it advances the fake
// clock instead of waiting.
export async function waitFor(
  check: () => unknown,
  { timeout = 3000, interval = POLL_MS }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const fake = vi.isFakeTimers();
  const attempts = Math.max(1, Math.ceil(timeout / interval));
  let lastError: unknown = new Error('waitFor: condition stayed false');
  for (let i = 0; i < attempts; i += 1) {
    try {
      if ((await check()) !== false) {
        return;
      }
      lastError = new Error('waitFor: condition stayed false');
    } catch (error) {
      lastError = error;
    }
    if (fake) {
      await vi.advanceTimersByTimeAsync(interval);
    } else {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, interval);
      });
    }
  }
  throw lastError;
}

// A real `Response`. A 204 gets a null body, as the platform requires. `init`
// is a status number or a `ResponseInit`.
export function jsonResponse(body: unknown, init: number | ResponseInit = 200): Response {
  const options = typeof init === 'number' ? { status: init } : init;
  const status = options.status ?? 200;
  return new Response(status === 204 || status === 205 ? null : JSON.stringify(body), {
    ...options,
    status,
  });
}

// `jsonResponse` with the status first, for tests written as `(status, body)`.
export function jsonResponseAt(status: number, body: unknown): Response {
  return jsonResponse(body, status);
}
