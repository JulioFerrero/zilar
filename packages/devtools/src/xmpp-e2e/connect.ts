// Client login for the XMPP end-to-end spike.
import { client, type XmppClient } from '@xmpp/client';
import { errorMessage, STEP_TIMEOUT_MS, withDeadline, type Runtime } from './harness';

export function connect(
  runtime: Runtime,
  localpart: string,
  password: string,
  resource: string,
): Promise<XmppClient> {
  const xmpp = client({
    service: runtime.websocketUrl,
    domain: runtime.domain,
    username: localpart,
    password,
    resource,
  });

  const deadline = withDeadline<XmppClient>(STEP_TIMEOUT_MS, () => {
    void xmpp.stop().catch(() => {});
    return new Error(`timed out logging in as ${localpart}`);
  });

  // This listener stays attached for the life of the client; after the
  // promise settles it only prevents an unhandled 'error' event.
  xmpp.on('error', (error) => {
    if (deadline.settled()) return;
    void xmpp.stop().catch(() => {});
    deadline.reject(new Error(`login failed for ${localpart}: ${error.message}`));
  });

  xmpp.on('online', () => {
    deadline.resolve(xmpp);
  });

  xmpp.start().catch((error: unknown) => {
    deadline.reject(
      new Error(`could not start the stream for ${localpart}: ${errorMessage(error)}`),
    );
  });

  return deadline.promise;
}

// Resolves with the rejection reason when the login fails, as expected.
export async function expectLoginFails(
  runtime: Runtime,
  localpart: string,
  password: string,
  label: string,
): Promise<string> {
  try {
    const xmpp = await connect(runtime, localpart, password, 'negative');
    await xmpp.stop().catch(() => {});
  } catch (error) {
    return errorMessage(error);
  }
  throw new Error(`${label}: the login unexpectedly succeeded`);
}
