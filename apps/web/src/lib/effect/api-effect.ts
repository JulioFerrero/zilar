import { makeFromApi } from '@zilar/client-core';
import { toApiFailure } from '@/lib/effect/errors';

/**
 * Lifts one api Promise call into an Effect that fails with an ApiFailure:
 * `fromApi(() => getMe())`. See `makeFromApi` in `@zilar/client-core`.
 */
export const fromApi = makeFromApi(toApiFailure);
