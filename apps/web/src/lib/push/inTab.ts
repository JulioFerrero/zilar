// While a Zilar tab is open but hidden, show a native notification from the page, which works
// where Web Push cannot; the tag collapses it with a real push for the same message.
import { Effect } from 'effect';
import { previewBody, type ChatSummary, type UiMessage } from '@zilar/chat-core';
import { getPushSettings } from '@/lib/api';
import { runWeb } from '@/lib/effect/runtime';
import { permissionStateOf, type NotificationPermissionState } from '@/lib/push';

// The service worker sets no icon; this keeps the in-tab notification looking like the app.
const ICON = '/icons/icon-192.png';

const NEW_MESSAGE = 'New message';

/** A rendered message with the origin id the ledger keeps beside it. */
export type InTabMessage = UiMessage & { readonly originId?: string | undefined };

export interface InTabNotification {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly chatId: string;
}

export interface InTabInput {
  readonly chat: ChatSummary | undefined;
  readonly message: InTabMessage;
  readonly permission: NotificationPermissionState | 'unsupported';
  readonly hidden: boolean;
  readonly showPreviews: boolean;
}

/** The pure decision: what to show, or undefined when nothing should. It never reads the DOM. */
export function inTabNotification(input: InTabInput): InTabNotification | undefined {
  const { chat, message, permission, hidden, showPreviews } = input;
  if (permission !== 'granted' || !hidden || chat === undefined || chat.muted) {
    return undefined;
  }
  const title =
    chat.kind === 'group' ? `${message.senderName} · ${chat.title}` : message.senderName;
  const preview = showPreviews ? previewBody(message) : '';
  return {
    title,
    body: preview === '' ? NEW_MESSAGE : preview,
    // The origin id the server names as messageId in the push payload, so both notifications collapse.
    tag: message.originId ?? chat.id,
    chatId: chat.id,
  };
}

// Cached after boot; a failure keeps the safe default (no text), and the Notifications page refreshes it.
let showPreviews = false;
let previewsLoaded = false;

/** Reads the previews setting once; a failure leaves the default and retries on the next boot. */
export function loadInTabPreviews(): void {
  if (previewsLoaded) {
    return;
  }
  void runWeb(
    Effect.tryPromise(() => getPushSettings()).pipe(
      Effect.tap((settings) =>
        Effect.sync(() => {
          showPreviews = settings.showPreviews;
          previewsLoaded = true;
        }),
      ),
      Effect.ignore,
    ),
  );
}

export function setInTabPreviews(value: boolean): void {
  showPreviews = value;
  previewsLoaded = true;
}

const isHidden = (): boolean =>
  typeof document !== 'undefined' &&
  (document.visibilityState !== 'visible' || !document.hasFocus());

function currentPermission(): NotificationPermissionState | 'unsupported' {
  return permissionStateOf({
    Notification: typeof Notification === 'undefined' ? undefined : Notification,
  });
}

export function showInTabNotification(chat: ChatSummary | undefined, message: InTabMessage): void {
  const decision = inTabNotification({
    chat,
    message,
    permission: currentPermission(),
    hidden: isHidden(),
    showPreviews,
  });
  if (decision !== undefined) {
    void runWeb(display(decision));
  }
}

function optionsFor(decision: InTabNotification): NotificationOptions & { renotify?: boolean } {
  return {
    body: decision.body,
    tag: decision.tag,
    renotify: true,
    data: { chatId: decision.chatId },
    icon: ICON,
  };
}

// The chat route the service worker's notificationclick opens (sw.js clickUrlFor), shared here.
function clickUrlFor(chatId: string): string {
  return `/c/${encodeURIComponent(chatId)}`;
}

function display(decision: InTabNotification): Effect.Effect<void> {
  return Effect.gen(function* () {
    const registration = yield* activeRegistration();
    if (registration !== undefined) {
      const shown = yield* Effect.tryPromise(() =>
        registration.showNotification(decision.title, optionsFor(decision)),
      ).pipe(
        Effect.as(true),
        Effect.catchCause(() => Effect.succeed(false)),
      );
      if (shown) {
        return;
      }
    }
    // No service worker registration (or its show failed): the page API.
    yield* Effect.sync(() => showWithPageApi(decision));
  });
}

function activeRegistration(): Effect.Effect<ServiceWorkerRegistration | undefined> {
  return Effect.gen(function* () {
    if (typeof navigator === 'undefined' || navigator.serviceWorker === undefined) {
      return undefined;
    }
    // ready never settles without a registration, so only wait on it when one exists.
    const existing = yield* Effect.tryPromise(() => navigator.serviceWorker.getRegistration()).pipe(
      Effect.catchCause(() => Effect.succeed(undefined)),
    );
    if (existing === undefined) {
      return undefined;
    }
    return yield* Effect.tryPromise(() => navigator.serviceWorker.ready).pipe(
      Effect.catchCause(() => Effect.succeed(undefined)),
    );
  });
}

function showWithPageApi(decision: InTabNotification): void {
  if (typeof Notification === 'undefined') {
    return;
  }
  const notification = new Notification(decision.title, optionsFor(decision));
  notification.onclick = () => {
    window.focus();
    window.location.assign(clickUrlFor(decision.chatId));
  };
}
