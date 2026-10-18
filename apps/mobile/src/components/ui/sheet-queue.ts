import { Effect } from 'effect';

/** iOS presents one controller at a time: every kit sheet present, dismiss and
 *  confirm waits for the previous transition to finish. */
let chain: Promise<void> = Promise.resolve();

// A failed present/dismiss (a sheet asked to present twice) is swallowed so it
// never breaks the queue; the 1.5 s cap keeps an unsettled transition from stalling.
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
