import type { Effect } from 'effect';

/**
 * What a `wake()` reported: the server still held the session (stream
 * management resumed it) or it bound a fresh one. A `rebound` means the
 * missed-message catch-up has to run (F3): nothing was replayed.
 */
export type WakeOutcome = 'resumed' | 'rebound';

/**
 * The background-lifecycle half of `XmppCore` (F1): `suspend()` parks the
 * session when the app leaves the foreground, `wake()` brings it back. Both
 * are optional, like `setPushEnabled`: callers feature-detect.
 */
export interface XmppSuspend {
  /**
   * Parks the session: stops the reconnect driver, the watchdog and the
   * keepalive, ends the socket without the framing `</stream>` so ejabberd
   * moves the session to pending and pushes per stanza, and keeps the
   * stream-management id so `wake()` can resume. Sets the status to
   * `offline`, not an error.
   */
  suspend?(): Promise<void>;
  /**
   * Brings the session back: starts the driver and reconnects. Resumes when
   * ejabberd still holds the session, else binds a fresh one.
   */
  wake?(): Promise<WakeOutcome>;
}

/** The same half of `XmppCore`, as Effects (see `XmppCoreEffect`). */
export interface XmppSuspendEffect {
  /** Never rejects for a parked session; fails like `connect` does. */
  suspend?(): Effect.Effect<void, Error>;
  /** Fails like `connect` when the session cannot come back. */
  wake?(): Effect.Effect<WakeOutcome, Error>;
}
