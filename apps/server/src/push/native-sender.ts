// The native (FCM) sender setup; `FCM_SERVICE_ACCOUNT_JSON` is the only
// input, and without it the sender stays undefined so a native device drops
// as `send-failed`. The private key goes straight into the token provider and
// is never logged, named or returned; the one log line says on or off.

import { readFcmConfig, type PushConfig } from './config';
import { createFcmSender, type FcmSender } from './fcm';
import { createFcmTokenProvider } from './fcm-token';

/** The one log call the setup needs; structural so pino and tests both fit. */
export interface NativeSenderLogger {
  info(message: string): void;
}

export function createNativeSender(
  push: PushConfig,
  logger: NativeSenderLogger,
): FcmSender | undefined {
  const fcm = readFcmConfig(push);
  if (fcm === null) {
    logger.info('push: native (FCM) sender off');
    return undefined;
  }
  logger.info('push: native (FCM) sender on');
  return createFcmSender({
    projectId: fcm.projectId,
    tokens: createFcmTokenProvider({ serviceAccount: fcm.serviceAccount }),
  });
}
