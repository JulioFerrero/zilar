import type { Effect } from 'effect';

/** What `wake()` reported: the server still held the session (`resumed`) or bound a
 * fresh one (`rebound`); nothing was replayed, so catch-up must run. */
export type WakeOutcome = 'resumed' | 'rebound';

/** `suspend()` parks the session when the app leaves the foreground; `wake()` brings
 * it back. Optional like `setPushEnabled`, so callers feature-detect. */
export interface XmppSuspend {
  /**
   * Stops the driver, watchdog and keepalive, ends the socket without the framing
   * `</stream>` so ejabberd moves the session to pending, and keeps the SM id so
   * `wake()` can resume. Sets the status to `offline`, not an error.
   */
  suspend?(): Promise<void>;
  /** Reconnects, resuming when ejabberd still holds the session, else binds fresh. */
  wake?(): Promise<WakeOutcome>;
}

/** The same half of `XmppCore`, as Effects (see `XmppCoreEffect`). */
export interface XmppSuspendEffect {
  /** Never rejects for a parked session; fails like `connect` does. */
  suspend?(): Effect.Effect<void, Error>;
  /** Fails like `connect` when the session cannot come back. */
  wake?(): Effect.Effect<WakeOutcome, Error>;
}
