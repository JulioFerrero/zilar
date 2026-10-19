import { Effect } from 'effect';

/** The raw rejection is kept, not mapped, so callers see their own error classes. */
export function rawCall<A>(call: () => Promise<A>) {
  return Effect.tryPromise({ try: call, catch: (cause) => ({ cause }) });
}

/** One group write with the fixed-sentence failure handler and optional cleanup. */
export function groupAction<A>(
  work: Effect.Effect<A, { readonly cause: unknown }>,
  fail: (cause: unknown) => void,
  settle?: () => void,
): Effect.Effect<void> {
  return work.pipe(
    Effect.catch(({ cause }) => Effect.sync(() => fail(cause))),
    Effect.ensuring(Effect.sync(() => settle?.())),
    Effect.asVoid,
  );
}
