import { ApiError } from '@zilar/api-contract';
import { PEOPLE_SEARCH_DEBOUNCE_MS } from '@zilar/chat-core';
import { Effect, Fiber } from 'effect';
import { useEffect, useReducer, useRef, useState } from 'react';
import { interruptFiber } from './use-delayed';

/**
 * The plain logic behind the `@handle` exact lookup. The lookup is exact and rate
 * limited, so it waits 900 ms after the last keystroke, fires at once on Enter, never
 * repeats the same handle in a row and never retries a 429 by itself. The typed text
 * is never logged, and every error is a fixed sentence, never the server's message.
 */

export { PEOPLE_SEARCH_DEBOUNCE_MS };

export const NO_PERSON_MESSAGE = 'No one with that username.';

export const PEOPLE_RATE_LIMITED_MESSAGE = 'Too many searches, try again in a few minutes.';

export const PEOPLE_LOOKUP_ERROR_MESSAGE = 'Could not look up that username. Try again.';

/**
 * The handle to look up, or null when the text does not start with `@` or the handle
 * is empty. Normalised with trim, one `@` stripped and lowercased.
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
 * The request state machine: `setText` restarts the debounce, `lookupNow` fires at
 * once. The same handle in a row never looks up twice, and a late answer after a newer
 * request is dropped by its request id.
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
   * Picks the controller up after a StrictMode unmount and remount: dispose froze
   * `setText` and cleared the debounce, so the current text is searched again.
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
 * The `@handle` lookup tied to a component; `submitRequest` is bumped by the search
 * field's Enter key to look up at once.
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

  // The search field's Enter key: look up at once; the initial zero never submits.
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
