import { Effect, Fiber } from 'effect';
import { ContactsApiError, type ContactsApi, type HandleProfile } from '../../lib/contacts-api';
import type { SearchScheduler } from '../chat/message-search';
import { addContactHandle } from './add-contact';

/**
 * The plain logic behind mobile people search (T-0193), kept pure and next
 * to the component so it can be unit-tested in Node: the debounced search
 * hook (`use-people-search.ts`) only wires timers and the API to this.
 *
 * Typing `@handle` in the chat-list search looks the person up: the
 * exact-handle lookup the add-contact flow already uses, with the same
 * normalisation (`addContactHandle` — no second rule). The lookup is exact
 * only (the server has no partial search) and rate limited, so it waits 900
 * ms after the last keystroke, fires at once on Enter, never repeats the
 * same handle in a row, and never retries a 429 by itself. A text that does
 * not start with `@` never calls the lookup. The typed text is never
 * logged; every error shown is a fixed sentence, never the server's raw
 * message.
 */

/** How long the hook waits after the last keystroke before looking up. */
export const PEOPLE_SEARCH_DEBOUNCE_MS = 900;

/** The single plain "no user" line for an unknown handle. */
export const NO_PERSON_MESSAGE = 'No one with that username.';

/** The fixed notice for a rate-limited lookup, shown once, never retried. */
export const PEOPLE_RATE_LIMITED_MESSAGE = 'Too many searches, try again in a few minutes.';

/** The fixed notice for any other lookup failure. */
export const PEOPLE_LOOKUP_ERROR_MESSAGE = 'Could not look up that username. Try again.';

/**
 * The handle to look up for the search text, or null when the text must not
 * look up: anything that does not start with `@`, or an empty handle. Uses
 * the exact same validation the add-contact flow uses.
 */
export function peopleHandleFor(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('@')) {
    return null;
  }
  return addContactHandle(trimmed);
}

export type PeopleSearchView =
  | { status: 'idle' }
  | { status: 'looking' }
  | { status: 'found'; profile: HandleProfile; sent: boolean }
  | { status: 'missing' }
  | { status: 'rateLimited' }
  | { status: 'error'; message: string };

export interface PeopleSearchControllerOptions {
  api: ContactsApi;
  onChange: () => void;
  frames?: SearchScheduler;
}

// The default clock: a fiber that sleeps, interrupted when it is cleared.
const defaultScheduler: SearchScheduler = {
  setTimeout: (callback, ms) =>
    Effect.runFork(Effect.sleep(ms).pipe(Effect.andThen(Effect.sync(callback)))),
  clearTimeout: (handle) => {
    Effect.runFork(Fiber.interrupt(handle as Fiber.Fiber<unknown, unknown>));
  },
};

/**
 * The request state machine behind `usePeopleSearch`. `setText` restarts
 * the debounce; `lookupNow` fires at once for Enter. The last requested
 * handle is cached: the same handle in a row never looks up twice — a new
 * lookup runs only once the text changes to a different handle. A late
 * answer after a newer request is dropped by its request id.
 */
export class PeopleSearchController {
  private api: ContactsApi;
  private readonly onChange: () => void;
  private readonly frames: SearchScheduler;
  private text = '';
  private timer: unknown = null;
  private requestId = 0;
  private lastRequested: string | null = null;
  private disposed = false;
  private current: PeopleSearchView = { status: 'idle' };

  constructor(options: PeopleSearchControllerOptions) {
    this.api = options.api;
    this.onChange = options.onChange;
    this.frames = options.frames ?? defaultScheduler;
  }

  get view(): PeopleSearchView {
    return this.current;
  }

  /** The profile and handle the action buttons work on, if any. */
  actionTarget(): { profile: HandleProfile; handle: string } | null {
    return this.current.status === 'found'
      ? { profile: this.current.profile, handle: this.current.profile.handle }
      : null;
  }

  setApi(api: ContactsApi): void {
    this.api = api;
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

  setFound(profile: HandleProfile, sent: boolean): void {
    if (this.disposed) {
      return;
    }
    this.set({ status: 'found', profile, sent });
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
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
    const api = this.api;
    const stillWanted = (): boolean => !this.disposed && id === this.requestId;
    Effect.runFork(
      Effect.tryPromise({ try: () => api.lookupByHandle(handle), catch: (cause) => cause }).pipe(
        Effect.match({
          onFailure: (error: unknown) => {
            if (stillWanted()) {
              this.set(failureView(error));
            }
          },
          onSuccess: (profile: HandleProfile) => {
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

  private set(view: PeopleSearchView): void {
    this.current = view;
    this.onChange();
  }
}

function failureView(error: unknown): PeopleSearchView {
  if (error instanceof ContactsApiError) {
    if (error.status === 404) {
      return { status: 'missing' };
    }
    if (error.status === 429 || error.code === 'rate_limited') {
      return { status: 'rateLimited' };
    }
  }
  return { status: 'error', message: PEOPLE_LOOKUP_ERROR_MESSAGE };
}
