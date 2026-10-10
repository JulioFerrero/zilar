import { Data } from 'effect';

/**
 * A chat store action's own failure: `message` is the sentence the store
 * wrote (a plain Error), or the component's fallback for a non-Error throw.
 */
export class StoreFailed extends Data.TaggedError('StoreFailed')<{ readonly message: string }> {}
