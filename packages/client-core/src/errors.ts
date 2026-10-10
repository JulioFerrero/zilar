import { Data } from 'effect';

/**
 * The typed failure of an api call lifted into Effect. It mirrors each app's
 * api error field for field, so a caller that matches on `code` or `status`
 * behaves the same.
 */
export class ApiFailure extends Data.TaggedError('ApiFailure')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly detail: Record<string, unknown>;
}> {}
