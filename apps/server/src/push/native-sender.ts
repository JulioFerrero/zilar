// The native (FCM) sender setup (native-push-plan.md §2.2-2.4, Task 4 of the
// split). `FCM_SERVICE_ACCOUNT_JSON` is the only input: without it the server
// runs exactly as before and a native device drops as `send-failed` (see
// `service.ts`), because the sender is left undefined. The service account's
// private key goes straight into the token provider and is never logged, named
// or returned; the one log line says on or off and carries no value.

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
