import { ApiError } from '@zilar/api-contract';
import { PEOPLE_SEARCH_DEBOUNCE_MS } from '@zilar/chat-core';
import { Effect, Fiber } from 'effect';
import { useEffect, useReducer, useRef, useState } from 'react';
import { interruptFiber } from './use-delayed';

/**
 * The plain logic behind the `@handle` exact lookup on both apps, kept pure
 * and testable in Node: the hook only wires timers and React state to this.
 *
 * Typing `@handle` in a search field looks the person up with the server's
 * exact-handle lookup. The lookup is exact only (the server has no partial
 * search) and rate limited, so it waits 900 ms after the last keystroke,
 * fires at once on Enter, never repeats the same handle in a row, and never
 * retries a 429 by itself. A text that does not start with `@` never calls
 * the lookup. The typed text is never logged; every error shown is a fixed
 * sentence, never the server's raw message.
 */

export { PEOPLE_SEARCH_DEBOUNCE_MS };

/** The single plain "no user" line for an unknown handle. */
export const NO_PERSON_MESSAGE = 'No one with that username.';

/** The fixed notice for a rate-limited lookup, shown once, never retried. */
export const PEOPLE_RATE_LIMITED_MESSAGE = 'Too many searches, try again in a few minutes.';

/** The fixed notice for any other lookup failure. */
export const PEOPLE_LOOKUP_ERROR_MESSAGE = 'Could not look up that username. Try again.';

/**
 * The handle to look up for the search text, or null when the text must not
 * look up: anything that does not start with `@`, or an empty handle. The
 * normalisation is trim, strip one `@` and lowercase.
 */
export function peopleHandleFor(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('@')) {
    return null;
  }
  const handle = trimmed.replace(/^@/, '').toLowerCase();
  return handle === '' ? null : handle;
}

export type PeopleSearchView<P> =
  | { status: 'idle' }
  | { status: 'looking' }
  | { status: 'found'; profile: P; sent: boolean }
  | { status: 'missing' }
  | { status: 'rateLimited' }
  | { status: 'error'; message: string };

/** A clock seam so tests can drive the controller deterministically. */
export interface PeopleSearchScheduler {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface PeopleSearchControllerOptions<P> {
  lookup: (handle: string) => Promise<P>;
  onChange: () => void;
  frames?: PeopleSearchScheduler;
}

// The default clock: a fiber that sleeps, interrupted when it is cleared.
const defaultScheduler: PeopleSearchScheduler = {
  setTimeout: (callback, ms) =>
    Effect.runFork(Effect.sleep(ms).pipe(Effect.andThen(Effect.sync(callback)))),
  clearTimeout: (handle) => {
    interruptFiber(handle as Fiber.Fiber<unknown, unknown>);
  },
};

/**
 * The request state machine behind `usePeopleHandleSearch`. `setText` restarts
 * the debounce; `lookupNow` fires at once for Enter. The last requested
 * handle is cached: the same handle in a row never looks up twice — a new
 * lookup runs only once the text changes to a different handle. A late
 * answer after a newer request is dropped by its request id.
 */
export class PeopleSearchController<P> {
  private lookup: (handle: string) => Promise<P>;
  private readonly onChange: () => void;
  private readonly frames: PeopleSearchScheduler;
  private text = '';
  private timer: unknown = null;
  private requestId = 0;
  private lastRequested: string | null = null;
  private disposed = false;
  private current: PeopleSearchView<P> = { status: 'idle' };

  constructor(options: PeopleSearchControllerOptions<P>) {
    this.lookup = options.lookup;
    this.onChange = options.onChange;
    this.frames = options.frames ?? defaultScheduler;
  }

  get view(): PeopleSearchView<P> {
    return this.current;
  }

  setLookup(lookup: (handle: string) => Promise<P>): void {
    this.lookup = lookup;
  }

  setText(text: string): void {
    if (this.disposed || text === this.text) {
      return;
    }
    this.text = text;
    this.refresh();
  }

  /** Looks up at once (Enter), skipping the debounce. */
  lookupNow(): void {
    if (this.disposed) {
      return;
    }
    const handle = peopleHandleFor(this.text);
    this.clearTimer();
    if (handle === null) {
      this.lastRequested = null;
      this.set({ status: 'idle' });
      return;
    }
    if (handle === this.lastRequested) {
      return;
    }
    this.runLookup(handle);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  /**
   * Picks the controller up again after a StrictMode unmount and remount:
   * dispose cleared the debounce and froze `setText`, so the current text is
   * searched again from scratch.
   */
  resume(): void {
    this.disposed = false;
    this.lastRequested = null;
    this.refresh();
  }

  private refresh(): void {
    const handle = peopleHandleFor(this.text);
    if (handle === null) {
      this.clearTimer();
      this.lastRequested = null;
      this.set({ status: 'idle' });
      return;
    }
    if (handle === this.lastRequested) {
      return;
    }
    this.set({ status: 'looking' });
    this.clearTimer();
    this.timer = this.frames.setTimeout(() => {
      this.timer = null;
      if (!this.disposed) {
        this.runLookup(handle);
      }
    }, PEOPLE_SEARCH_DEBOUNCE_MS);
  }

  private runLookup(handle: string): void {
    this.lastRequested = handle;
    this.set({ status: 'looking' });
    const id = this.nextId();
    const lookup = this.lookup;
    const stillWanted = (): boolean => !this.disposed && id === this.requestId;
    Effect.runFork(
      Effect.tryPromise({ try: () => lookup(handle), catch: (cause) => cause }).pipe(
        Effect.match({
          onFailure: (error: unknown) => {
            if (stillWanted()) {
              this.set(failureView<P>(error));
            }
          },
          onSuccess: (profile: P) => {
            if (stillWanted()) {
              this.set({ status: 'found', profile, sent: false });
            }
          },
        }),
      ),
    );
  }

  private nextId(): number {
    this.requestId += 1;
    return this.requestId;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.frames.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private set(view: PeopleSearchView<P>): void {
    this.current = view;
    this.onChange();
  }
}

/**
 * The `@handle` lookup tied to a component: the debounced exact lookup over
 * the latest `lookup` (callers may pass a new lambda each render).
 * `submitRequest` is bumped by the search field's Enter key to look up at
 * once.
 */
export function usePeopleHandleSearch<P>(
  lookup: (handle: string) => Promise<P>,
  text: string,
  submitRequest?: number,
): { view: PeopleSearchView<P>; target: P | null } {
  const [, force] = useReducer((count: number) => count + 1, 0);
  const [controller] = useState(() => new PeopleSearchController<P>({ lookup, onChange: force }));

  useEffect(() => {
    controller.setLookup(lookup);
  }, [controller, lookup]);

  useEffect(() => {
    controller.setText(text);
  }, [controller, text]);

  useEffect(() => {
    controller.resume();
    return () => controller.dispose();
  }, [controller]);

  // The search field's Enter key: look up at once instead of waiting out the
  // debounce. The initial zero never submits (the debounce owns first paint).
  const lastSubmit = useRef(0);
  useEffect(() => {
    if (submitRequest === undefined || submitRequest === lastSubmit.current) {
      return;
    }
    lastSubmit.current = submitRequest;
    if (submitRequest !== 0) {
      controller.lookupNow();
    }
  }, [controller, submitRequest]);

  return {
    view: controller.view,
    target: controller.view.status === 'found' ? controller.view.profile : null,
  };
}

function failureView<P>(error: unknown): PeopleSearchView<P> {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return { status: 'missing' };
    }
    if (error.status === 429 || error.code === 'rate_limited') {
      return { status: 'rateLimited' };
    }
  }
  return { status: 'error', message: PEOPLE_LOOKUP_ERROR_MESSAGE };
}
