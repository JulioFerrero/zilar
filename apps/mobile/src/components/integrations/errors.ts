import { IntegrationsApiError } from '../../lib/integrations-api';

/**
 * Maps the integrations error codes to fixed plain sentences, mirroring
 * web's `friendlyError` in `apps/web/src/routes/IntegrationsPage.tsx`.
 * User-facing text is never the server's raw message; the `fallback` the
 * call site passes answers anything unknown.
 */
export function describeIntegrationsError(error: unknown, fallback: string): string {
  if (error instanceof IntegrationsApiError) {
    switch (error.code) {
      case 'invalid_token':
        return 'Telegram rejected the bot token. Check it and try again.';
      case 'mail_send_failed':
        return 'The test email could not be sent. Check the Resend key and the sender address.';
      case 'managed_by_environment':
        return 'This is managed by environment variables on this server.';
      case 'endpoint_unreachable':
        return 'The transcription endpoint could not be reached. Check the URL.';
      case 'endpoint_rejected':
        return 'The transcription endpoint rejected the test request. Check the URL, key and model.';
      case 'rate_limited':
        return 'Too many tries. Wait a little and try again.';
      case 'network_error':
        return 'Could not reach the server.';
      default:
        return fallback;
    }
  }
  return fallback;
}
