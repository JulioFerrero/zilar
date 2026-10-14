import { Exit, Schema } from 'effect';
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
 * The native (FCM) push registration of the phone (T-1139, plan §4.3). Unlike
 * web, the app talks to FCM directly: `getDevicePushTokenAsync` gives the
 * device token, and the Expo push *token* service is never used. The server
 * stores `{ kind: 'fcm', token }` and answers the node and JID the session
 * enables over XEP-0357. Every call is best effort: a failure leaves the app
 * running and is retried on the next cold start (the server dedupes on
 * `(user_id, token)`).
 */

/** The device label the server stores, like the web client's user agent. */
export const NATIVE_PUSH_USER_AGENT = 'Zilar Android';

/** SecureStore key holding the last successful registration (T-1139). */
export const PUSH_REGISTRATION_KEY = 'zilar.push.registration';

/** The sign-out DELETE is best effort: never block the sign-out longer. */
const UNREGISTER_TIMEOUT_MS = 3000;

export interface PushPairInput {
  pushJid: string;
  node: string;
  enable: boolean;
}

/** The store action that toggles the XEP-0357 pair (`effects/push-pair.ts`). */
export type SetPushPair = (input: PushPairInput) => Promise<void>;

export interface NativePushDeps {
  setPushPair: SetPushPair;
  getToken?: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  apiUrl?: string;
}

export type UnregisterNativePushDeps = Omit<NativePushDeps, 'setPushPair'>;

type Registration = typeof RegisteredDevice.Type;

/** The stored registration shape, as the settings diagnostics screen reads it. */
export type StoredPushRegistration = Registration;

/** The stored registration, or undefined when the key is missing or malformed. */
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
 * The registration this phone stored, or undefined when the key is missing or
 * malformed. Best effort: a SecureStore failure answers undefined. The
 * settings diagnostics screen matches its own row by this `id`.
 */
export async function readStoredRegistration(): Promise<StoredPushRegistration | undefined> {
  try {
    return parseRegistration(await SecureStore.getItemAsync(PUSH_REGISTRATION_KEY));
  } catch {
    return undefined;
  }
}

/** Races `task` against a timeout; the timer is always cleared. */
function withTimeout<A>(task: Promise<A>, ms: number): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('push request timed out')), ms);
  });
  return Promise.race([task, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

// One registration per device token per session (T-1150): the push-token
// listener fires while `getDevicePushTokenAsync` runs, so `registerNativePush`
// and `watchPushTokenRolls` can both call `registerToken` with the same token.
// An in-flight promise and the last token collapse that pair into one POST and
// one enable; a real roll (a new token) registers normally.
let inFlight: { token: string; done: Promise<void> } | null = null;
let lastRegisteredToken: string | null = null;

/**
 * Stores one device token: POST it, enable the XEP-0357 pair over the chat
 * session, then remember `{ id, node, jid }` so sign-out can delete the row.
 * A failed enable is not fatal: the registration is still saved, and the next
 * launch retries the enable.
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
 * Dedupes `registerTokenOnce` within one session: a second call for the token
 * already in flight awaits the running one, and a call for the token that
 * already succeeded here does nothing.
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
 * Re-sends the XEP-0357 `<enable/>` for the saved registration, without a new
 * POST (T-1152). ejabberd binds the pair to the session that sent it, so a
 * reconnect or a wake runs a new session whose pair is missing (MP-2); the
 * saved registration still holds the server's node and JID for exactly this.
 * Best effort like the first enable: a failure only reaches `console.warn`
 * (never the node) and the next online retries (MP-13).
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
 * Registers this device for native push, best effort. On Android it creates the
 * notification channel before asking for the permission, as the OS needs a
 * channel for the prompt to appear (plan §4.2). It stops quietly when the
 * permission is denied and never throws.
 */
export async function registerNativePush(deps: NativePushDeps): Promise<void> {
  try {
    // The provider calls this once per signed-in session, so a new call starts
    // a new session: drop the previous dedup so the token is registered — and
    // its enable re-sent — again. The server answers the same node for the same
    // token now, so this does not churn the enable-pair (T-1150).
    lastRegisteredToken = null;
    if (Platform.OS === 'android') {
      for (const channel of CHAT_CHANNELS) {
        await Notifications.setNotificationChannelAsync(channel.id, {
          name: channel.name,
          importance: Notifications.AndroidImportance.HIGH,
        });
      }
      // T-1302 (MUX-23): the single "Messages" channel became the three above.
      // Deleting the old id leaves Settings with exactly the three; it is a
      // no-op after the first launch and never fatal to the registration.
      try {
        await Notifications.deleteNotificationChannelAsync(LEGACY_CHANNEL_ID);
      } catch {
        // Best effort, like the enable: the stale channel only shows in Settings.
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
 * Re-registers the device when FCM rolls its token. The listener receives the
 * new token, so `getDevicePushTokenAsync` is not called again from inside it
 * (the Expo docs warn that triggers the listener itself).
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
 * Deletes this device's row on sign-out, before the bearer token is cleared. A
 * missing key or a failed request is ignored, and the key is always cleared.
 * Sending `<disable/>` is not needed: the server drops publishes for an unknown
 * node.
 */
export async function unregisterNativePush(deps: UnregisterNativePushDeps = {}): Promise<void> {
  const { getToken = getSessionToken, fetchImpl = fetch, apiUrl = API_URL } = deps;
  try {
    const raw = await SecureStore.getItemAsync(PUSH_REGISTRATION_KEY);
    const registration = parseRegistration(raw);
    if (registration !== undefined) {
      const client = createApiClient({ getToken, fetchImpl, apiUrl });
      await withTimeout(
        runApi(client.push.remove({ params: { id: registration.id } })),
        UNREGISTER_TIMEOUT_MS,
      );
    }
  } catch (error) {
    console.warn('native push: unregistration failed', error);
  } finally {
    await clearRegistration();
  }
}
