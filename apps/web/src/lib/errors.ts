import { Data } from 'effect';

/** message is the sentence the store wrote, or the component's fallback for a non-Error throw. */
export class StoreFailed extends Data.TaggedError('StoreFailed')<{ readonly message: string }> {}
