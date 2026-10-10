import { Data } from 'effect';
import type { AsyncResult } from 'effect/reactivity';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting } from '@/lib/effect/use-action';

/** Which of the three page states the integrations page is in. */
export type PageStatus = 'loading' | 'ready' | 'forbidden';

/** The form's own checks, each one before anything is sent. */
export class SenderMissing extends Data.TaggedError('SenderMissing') {}
export class EndpointMissing extends Data.TaggedError('EndpointMissing') {}
export class TokenMissing extends Data.TaggedError('TokenMissing') {}

/** The last failure, hidden while a new call runs (the page cleared it at once before). */
export function shownFailure<A, E>(state: AsyncResult.AsyncResult<A, E>): E | undefined {
  return isWaiting(state) ? undefined : failureOf(state);
}

export function friendlyError(error: ApiFailure): string {
  if (error.code === 'unknown_error') {
    return 'Something went wrong. Try again.';
  }
  if (error.code === 'invalid_token') {
    return 'Telegram rejected the bot token. Check it and try again.';
  }
  if (error.code === 'mail_send_failed') {
    return 'The test email could not be sent. Check the Resend key and the sender address.';
  }
  if (error.code === 'managed_by_environment') {
    return 'Email is managed by environment variables on this server.';
  }
  if (error.code === 'endpoint_unreachable') {
    return 'The transcription endpoint could not be reached. Check the URL.';
  }
  if (error.code === 'endpoint_rejected') {
    return 'The transcription endpoint rejected the test request. Check the URL, key and model.';
  }
  if (error.code === 'rate_limited') {
    return 'Too many tries — wait a little and try again.';
  }
  if (error.code === 'network_error') {
    return 'Could not reach the server.';
  }
  return error.message;
}
