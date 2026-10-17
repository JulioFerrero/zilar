import { Effect } from 'effect';

/** iOS presents one controller at a time (T-1931): every kit sheet present,
 *  dismiss and confirm waits for the previous transition to finish. */
let chain: Promise<void> = Promise.resolve();

// The transition runs through Effect so a failed present/dismiss (for example a
// sheet asked to present twice) is swallowed and never breaks the queue. The
// 1.5 s cap keeps a transition that never settles (a sheet unmounted mid-animation)
// from stalling every later sheet app-wide.
function runTransition(run: () => Promise<unknown> | void): Promise<void> {
  return Effect.runPromise(
    Effect.tryPromise({ try: async () => run(), catch: () => undefined }).pipe(
      Effect.timeout('1500 millis'),
      Effect.ignore,
    ),
  );
}

export function queueSheetTransition(run: () => Promise<unknown> | void): Promise<void> {
  const next = chain
    .then(
      () => runTransition(run),
      () => runTransition(run),
    )
    .then(
      () => undefined,
      () => undefined,
    );
  chain = next;
  return next;
}
