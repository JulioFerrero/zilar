import { vi } from 'vitest';

// The one place tests wait for async work. A test that waits "one tick" for a
// visible state is flaky on a busy CI box: wait for the state with `waitFor`
// instead. Raw `setTimeout(resolve, 0)` waits in test files are banned by
// `src/test/noRawTimeoutWaits.test.ts`.

const POLL_MS = 10;

// React's `act`, loaded on demand so a store test never imports React.
async function inAct(work: () => Promise<void>): Promise<void> {
  const { act } = await import('react');
  await act(work);
}

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

// `flushTasks` inside React's `act`, for component tests.
export async function settle(turns = 2): Promise<void> {
  await inAct(() => flushTasks(turns));
}

// Polls `check` until it stops throwing and does not return `false`. Works
// with real and fake timers: under `vi.useFakeTimers()` it advances the fake
// clock instead of waiting. `act: true` runs every pause inside React's `act`.
export async function waitFor(
  check: () => unknown,
  {
    timeout = 3000,
    interval = POLL_MS,
    act = false,
  }: { timeout?: number; interval?: number; act?: boolean } = {},
): Promise<void> {
  const attempts = Math.max(1, Math.ceil(timeout / interval));
  const pause = async (): Promise<void> => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(interval);
    } else {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, interval);
      });
    }
  };
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
    if (act) {
      await inAct(pause);
    } else {
      await pause();
    }
  }
  throw lastError;
}

// `waitFor` with every pause inside React's `act`, for component tests.
export function waitForAct(
  check: () => unknown,
  options: { timeout?: number; interval?: number } = {},
): Promise<void> {
  return waitFor(check, { ...options, act: true });
}

// A real `Response` with a JSON content type. A 204 gets a null body, as the
// platform requires. `init` is a status number or a `ResponseInit`.
export function jsonResponse(body: unknown, init: number | ResponseInit = 200): Response {
  const options = typeof init === 'number' ? { status: init } : init;
  const status = options.status ?? 200;
  return new Response(status === 204 || status === 205 ? null : JSON.stringify(body), {
    ...options,
    status,
    headers: {
      'content-type': 'application/json',
      ...Object.fromEntries(new Headers(options.headers)),
    },
  });
}

// `jsonResponse` with the status first, for tests written as `(status, body)`.
export function jsonResponseAt(status: number, body: unknown): Response {
  return jsonResponse(body, status);
}
