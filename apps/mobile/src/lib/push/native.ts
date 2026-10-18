import { Duration, Effect, Exit, Schema } from 'effect';
import type { EventSubscription } from 'expo-modules-core';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { RegisteredDevice, runApi } from '@zilar/api-contract';

import { API_URL } from '../auth';
import { createApiClient } from '../effect/api-client';
import { getSessionToken } from '../session-token';
import { CHAT_CHANNELS, LEGACY_CHANNEL_ID } from './channels';

/**
 * Unlike web, the app talks to FCM directly (`getDevicePushTokenAsync`), never the Expo push service. Every call is best effort; the next cold start retries and the server dedupes on `(user_id, token)`.
 */

export const NATIVE_PUSH_USER_AGENT = 'Zilar Android';

export const PUSH_REGISTRATION_KEY = 'zilar.push.registration';

/** The sign-out DELETE is best effort: never block the sign-out longer. */
const UNREGISTER_TIMEOUT_MS = 3000;

export interface PushPairInput {
  pushJid: string;
  node: string;
  enable: boolean;
}

export type SetPushPair = (input: PushPairInput) => Promise<void>;

export interface NativePushDeps {
  setPushPair: SetPushPair;
  getToken?: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  apiUrl?: string;
}

export type UnregisterNativePushDeps = Omit<NativePushDeps, 'setPushPair'>;

type Registration = typeof RegisteredDevice.Type;

export type StoredPushRegistration = Registration;

function parseRegistration(raw: string | null): Registration | undefined {
  if (raw === null || raw === '') {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const decoded = Schema.decodeUnknownExit(RegisteredDevice)(value);
  return Exit.isSuccess(decoded) ? decoded.value : undefined;
}

async function saveRegistration(registration: Registration): Promise<void> {
  await SecureStore.setItemAsync(PUSH_REGISTRATION_KEY, JSON.stringify(registration));
}

async function clearRegistration(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PUSH_REGISTRATION_KEY);
  } catch {
    // Best effort: the stale key can never make the app fail.
  }
}

/**
 * Best effort: a SecureStore failure answers undefined.
 */
export async function readStoredRegistration(): Promise<StoredPushRegistration | undefined> {
  try {
    return parseRegistration(await SecureStore.getItemAsync(PUSH_REGISTRATION_KEY));
  } catch {
    return undefined;
  }
}

// The push-token listener fires while `getDevicePushTokenAsync` runs, so two callers can register the same token; an in-flight promise and the last token collapse them into one POST and one enable.
let inFlight: { token: string; done: Promise<void> } | null = null;
let lastRegisteredToken: string | null = null;

/**
 * A failed enable is not fatal: the registration is still saved and the next launch retries the enable.
 */
async function registerTokenOnce(deviceToken: string, deps: NativePushDeps): Promise<void> {
  const { setPushPair, getToken = getSessionToken, fetchImpl = fetch, apiUrl = API_URL } = deps;
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const registration = await runApi(
    client.push.subscribe({
      payload: { kind: 'fcm', token: deviceToken, userAgent: NATIVE_PUSH_USER_AGENT },
    }),
  );
  try {
    await setPushPair({ pushJid: registration.jid, node: registration.node, enable: true });
  } catch (error) {
    console.warn('native push: the chat session could not enable push', error);
  }
  await saveRegistration(registration);
}

/**
 * A second call for the in-flight token awaits it; a call for the token that already succeeded does nothing.
 */
async function registerToken(deviceToken: string, deps: NativePushDeps): Promise<void> {
  if (inFlight !== null && inFlight.token === deviceToken) {
    return inFlight.done;
  }
  if (deviceToken === lastRegisteredToken) {
    return;
  }
  const done = registerTokenOnce(deviceToken, deps);
  inFlight = { token: deviceToken, done };
  try {
    await done;
    lastRegisteredToken = deviceToken;
  } finally {
    if (inFlight !== null && inFlight.done === done) {
      inFlight = null;
    }
  }
}

/**
 * ejabberd binds the XEP-0357 pair to the session that sent it, so a reconnect or a wake needs a fresh `<enable/>`; the saved registration holds the node and JID. Best effort, and a failure never reaches the node.
 */
export async function ensurePushPair(deps: Pick<NativePushDeps, 'setPushPair'>): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(PUSH_REGISTRATION_KEY);
    const registration = parseRegistration(raw);
    if (registration === undefined) {
      return;
    }
    await deps.setPushPair({
      pushJid: registration.jid,
      node: registration.node,
      enable: true,
    });
  } catch (error) {
    console.warn('native push: the chat session could not re-enable push', error);
  }
}

/**
 * Android needs the notification channel before the permission prompt appears. It stops quietly when the permission is denied and never throws.
 */
export async function registerNativePush(deps: NativePushDeps): Promise<void> {
  try {
    // A new signed-in session drops the previous dedup, so the token is registered and its enable re-sent; the server answers the same node and the pair does not churn.
    lastRegisteredToken = null;
    if (Platform.OS === 'android') {
      for (const channel of CHAT_CHANNELS) {
        await Notifications.setNotificationChannelAsync(channel.id, {
          name: channel.name,
          importance: Notifications.AndroidImportance.HIGH,
        });
      }
      // Deleting the legacy channel leaves Settings with exactly the three; it is a no-op after the first launch.
      try {
        await Notifications.deleteNotificationChannelAsync(LEGACY_CHANNEL_ID);
      } catch {
        // A stale channel only shows in Settings.
      }
    }
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) {
      return;
    }
    const { data } = await Notifications.getDevicePushTokenAsync();
    if (typeof data !== 'string' || data === '') {
      console.warn('native push: the device did not return a token');
      return;
    }
    await registerToken(data, deps);
  } catch (error) {
    console.warn('native push: registration failed', error);
  }
}

/**
 * The listener already receives the new token; calling `getDevicePushTokenAsync` inside it would trigger the listener again.
 */
export function watchPushTokenRolls(deps: NativePushDeps): EventSubscription {
  return Notifications.addPushTokenListener(({ data }) => {
    if (typeof data !== 'string' || data === '') {
      return;
    }
    void registerToken(data, deps).catch((error) => {
      console.warn('native push: re-registration failed', error);
    });
  });
}

/**
 * Runs before the bearer token is cleared; a missing key or a failed request is ignored, and the key is always cleared. No `<disable/>` is needed: the server drops publishes for an unknown node.
 */
export async function unregisterNativePush(deps: UnregisterNativePushDeps = {}): Promise<void> {
  const { getToken = getSessionToken, fetchImpl = fetch, apiUrl = API_URL } = deps;
  try {
    const raw = await SecureStore.getItemAsync(PUSH_REGISTRATION_KEY);
    const registration = parseRegistration(raw);
    if (registration !== undefined) {
      const client = createApiClient({ getToken, fetchImpl, apiUrl });
      await Effect.runPromise(
        Effect.timeoutOrElse(
          Effect.tryPromise(() => runApi(client.push.remove({ params: { id: registration.id } }))),
          {
            duration: Duration.millis(UNREGISTER_TIMEOUT_MS),
            orElse: () => Effect.fail(new Error('push request timed out')),
          },
        ),
      );
    }
  } catch (error) {
    console.warn('native push: unregistration failed', error);
  } finally {
    await clearRegistration();
  }
}
