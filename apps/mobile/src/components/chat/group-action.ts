import { Effect } from 'effect';

// The raw rejection is kept, not mapped, so describeRolesError and the
// DirectoryApiError check still see their own error classes.
export function rawCall<A>(call: () => Promise<A>) {
  return Effect.tryPromise({ try: call, catch: (cause) => ({ cause }) });
}

/**
 * One raw call with the group screen's fixed-sentence failure handler and its
 * optional cleanup. Every group write re-inlined the same `catch` + `ensuring`
 * shape; the sentence itself stays with the caller, so the mapping (roles) or
 * the fixed text (links, archive, pref, visibility) is unchanged.
 */
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
