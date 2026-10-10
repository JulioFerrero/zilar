import { vi } from 'vitest';

// The one place server tests wait for async work. Raw `setTimeout(resolve, 0)`
// waits in test files are banned by `src/test-support/noRawTimeoutWaits.test.ts`.

const POLL_MS = 10;

export interface WaitForOptions {
  timeout?: number;
  interval?: number;
  // Names the condition in the timeout error.
  label?: string | undefined;
}

// Lets pending promise callbacks run. A few rounds, because one resolved
// promise often schedules the next one.
export async function flushMicrotasks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

// Polls `check` until it stops throwing and does not return `false`. Works
// with real and fake timers: under `vi.useFakeTimers()` it advances the fake
// clock instead of waiting. The second argument is the options, or a timeout in
// milliseconds followed by a label, as the machine hub tests write it.
export async function waitFor(
  check: () => unknown,
  options: number | WaitForOptions = {},
  label?: string,
): Promise<void> {
  const resolved: WaitForOptions =
    typeof options === 'number' ? { timeout: options, label } : options;
  const { timeout = 5000, interval = POLL_MS } = resolved;
  const attempts = Math.max(1, Math.ceil(timeout / interval));
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      if ((await check()) !== false) {
        return;
      }
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(interval);
    } else {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, interval);
      });
    }
  }
  if (lastError !== undefined) {
    throw lastError;
  }
  throw new Error(`timed out waiting for ${resolved.label ?? 'the condition'}`);
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
