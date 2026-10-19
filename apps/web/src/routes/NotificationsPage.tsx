import { Switch } from '../components/ui/switch';
import { Button } from '../components/ui/button';
import { Card, SectionLabel } from '../components/ui/card';
import { EntityAvatar } from '@/components/EntityAvatar';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { StateMessage } from '@/components/ui/state-message';
import type { PushDevice } from '@/lib/api';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { isIosDevice, isStandaloneDisplay } from '@/lib/push';
import type { StoredDevice } from '@/lib/push/deviceStorage';
import { usePushEnable } from '@/lib/push/usePushEnable';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import {
  deviceName,
  formatRelativeAudit,
  type ChatSummary,
  formatListTime,
} from '@zilar/chat-core';
import { Data, Effect } from 'effect';
import { Bell, BellOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

const BLOCKED_DETAIL =
  "Notifications are blocked for this site. Allow them in the browser's site settings, then reload.";

function ThisDeviceCard({
  state,
  detail,
  enabled,
  busy,
  errorMessage = '',
  onEnable,
  onDisable,
}: {
  state: 'Enabled' | 'Not enabled' | 'Blocked by the browser' | 'Only while open';
  detail: string;
  enabled: boolean;
  busy: boolean;
  errorMessage?: string;
  onEnable: () => void;
  onDisable: () => void;
}) {
  // A browser that blocked notifications cannot be asked again from the page:
  // no Enable button, just how to unblock it.
  const blocked = state === 'Blocked by the browser';
  return (
    <section aria-label="Notifications on this device" className="flex flex-col gap-2">
      <SectionLabel>This device</SectionLabel>
      <Card className="divide-divider">
        <div className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 basis-40">
              <span className="block text-[15px] font-medium">{state}</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">
                {blocked ? BLOCKED_DETAIL : detail}
              </span>
            </span>
            {!blocked &&
              (!enabled ? (
                <Button type="button" onClick={onEnable} disabled={busy}>
                  <Bell className="size-4" aria-hidden="true" />
                  {busy ? 'Enabling…' : 'Enable on this device'}
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={onDisable} disabled={busy}>
                  <BellOff className="size-4" aria-hidden="true" />
                  {busy ? 'Disabling…' : 'Disable'}
                </Button>
              ))}
          </div>
          {errorMessage !== '' && (
            <p role="alert" className="mt-2 text-[14px] text-danger">
              {errorMessage}
            </p>
          )}
        </div>
      </Card>
    </section>
  );
}

function DeviceStatusCard({ title, detail }: { title: string; detail: string }) {
  return (
    <section aria-label="Notifications on this device" className="flex flex-col gap-2">
      <SectionLabel>This device</SectionLabel>
      <Card className="divide-divider">
        <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
          <span className="min-w-0 flex-1 basis-40">
            <span className="block text-[15px] font-medium">{title}</span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">{detail}</span>
          </span>
        </div>
      </Card>
    </section>
  );
}

function PreviewsSection({
  showPreviews,
  onToggle,
}: {
  showPreviews: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <section aria-label="Message previews" className="flex flex-col gap-2">
      <SectionLabel>Message previews</SectionLabel>
      <Card className="divide-divider">
        <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
          <Switch
            checked={showPreviews}
            onCheckedChange={(value) => onToggle(value)}
            label="Show the first lines of new messages in notifications"
          />
        </div>
      </Card>
      <p className="text-[13px] text-muted-foreground">
        Off means who and where only — never message text.
      </p>
    </section>
  );
}

function DevicesSection({
  devices,
  storedDevice,
  onRemove,
}: {
  devices: PushDevice[];
  storedDevice: StoredDevice | null;
  onRemove: (id: string) => void;
}) {
  const now = new Date();
  return (
    <section aria-label="Devices" className="flex flex-col gap-2">
      <SectionLabel>Devices</SectionLabel>
      {devices.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">No devices yet.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-divider">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1 basis-40 text-[14px]">
                  <p className="truncate text-[15px] font-medium">
                    {deviceName(device)}
                    {storedDevice !== null && device.id === storedDevice.id ? ' (this device)' : ''}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    Added {new Date(device.createdAt).toLocaleDateString()} ·{' '}
                    {device.lastUsedAt !== null
                      ? `Last push: ${formatRelativeAudit(new Date(device.lastUsedAt), now)}`
                      : 'No push yet'}
                    {device.inactive ? ' · inactive' : ''}
                  </p>
                  {device.failedAt !== null && (
                    <p className="mt-0.5 text-[13px] text-danger">
                      Failed {formatRelativeAudit(new Date(device.failedAt), now)}:{' '}
                      {device.lastFailure ?? 'unknown'}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onRemove(device.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

const UNMUTE_ERROR = 'Could not unmute. Try again.';
// `mutedUntilFor('forever')` is 100 years out; anything at least this far out
// reads as "always" (chat-core keeps the sentinel private).
const FOREVER_MUTE_YEAR = 2100;

class UnmuteFailed extends Data.TaggedError('UnmuteFailed') {}

function MutedChatsSection() {
  const chats = useChatSelector((s) => s.chats);
  const chatPrefs = useChatSelector((s) => s.chatPrefs);
  const storeApi = useChatStoreApi();
  const [error, setError] = useState<string | undefined>(undefined);

  // Only rows muted by their own pref are listed: a group mute lives on the
  // General row and its other topics inherit it, so listing every topic would
  // repeat the group. The General row itself is included.
  const muted = useMemo((): ChatSummary[] => {
    return chats.filter((chat) => {
      if (!chat.muted) {
        return false;
      }
      return (
        chat.topic === undefined ||
        chat.topic.isGeneral ||
        chatPrefs[chat.id.toLowerCase()] !== undefined
      );
    });
  }, [chats, chatPrefs]);

  const [state, unmute] = useAction<string, void, UnmuteFailed>((chatId) =>
    Effect.tryPromise({
      try: () => storeApi.getState().setMuted(chatId, null),
      catch: () => new UnmuteFailed(),
    }).pipe(Effect.tapError(() => Effect.sync(() => setError(UNMUTE_ERROR)))),
  );
  const busy = isWaiting(state);
  const startUnmute = (chatId: string): void => {
    if (busy) {
      return;
    }
    setError(undefined);
    unmute(chatId);
  };

  return (
    <section aria-label="Muted chats" className="flex flex-col gap-2">
      <SectionLabel>Muted chats</SectionLabel>
      {muted.length === 0 ? (
        <StateMessage kind="empty" title="No muted chats." />
      ) : (
        <Card>
          <ul className="divide-y divide-divider">
            {muted.map((chat) => (
              <li key={chat.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <EntityAvatar chat={chat} size={36} />
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block truncate text-[15px] font-medium">{chat.title}</span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    {muteEndLabel(chatPrefs[chat.id.toLowerCase()]?.mutedUntil ?? null, new Date())}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => startUnmute(chat.id)}
                >
                  Unmute
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {error !== undefined && (
        <p role="alert" className="text-[14px] text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function muteEndLabel(mutedUntil: string | null, now: Date): string {
  const date = mutedUntil === null ? undefined : new Date(mutedUntil);
  if (
    date === undefined ||
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() >= FOREVER_MUTE_YEAR
  ) {
    return 'always';
  }
  return `until ${formatListTime(date, now)}`;
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const {
    status,
    devices,
    showPreviews,
    storedDevice,
    permission,
    busy,
    testing,
    testSent,
    onlyWhileOpen,
    errorMessage,
    errorScope,
    enableOnThisDevice,
    disableOnThisDevice,
    removeOtherDevice,
    togglePreviews,
    sendTest,
  } = usePushEnable();

  const thisDevice =
    storedDevice === null ? undefined : devices.find((entry) => entry.id === storedDevice.id);
  const cardState: 'Enabled' | 'Not enabled' | 'Blocked by the browser' =
    thisDevice !== undefined
      ? 'Enabled'
      : permission === 'denied'
        ? 'Blocked by the browser'
        : 'Not enabled';
  const cardDetail =
    thisDevice !== undefined
      ? thisDevice.inactive
        ? 'On, but inactive — nothing received in 90 days.'
        : 'Push is on for this device.'
      : 'Turn on push for this browser.';
  const showIosHint =
    status === 'ready' &&
    isIosDevice() &&
    !isStandaloneDisplay({
      matchMedia: (query) => window.matchMedia(query),
      standalone: (window.navigator as { standalone?: boolean }).standalone,
    });
  // The device card and the only-while-open card share the device message; a test failure
  // stays next to the Test button.
  const cardError = errorScope === 'card' && errorMessage !== '';

  return (
    <SettingsShell
      title="Notifications"
      subtitle="Push this device when a message arrives."
      onBack={() => navigate('/settings')}
    >
      <div className={SETTINGS_COLUMN}>
        {status === 'loading' && (
          <StateMessage kind="loading" title="Loading notification settings…" />
        )}
        {status === 'unsupported' && (
          <DeviceStatusCard
            title="Not supported"
            detail="Push notifications are not supported in this browser. Try a recent Chrome, Edge, Firefox or Safari."
          />
        )}
        {status === 'server-off' && (
          <DeviceStatusCard
            title="Not available"
            detail="Push notifications are not enabled on this server yet."
          />
        )}
        {status === 'ready' && (
          <div className="flex flex-col gap-4">
            {showIosHint && (
              <p className="rounded-xl border border-border bg-surface-raised p-3 text-[14px]">
                On iPhone, push needs the installed app (iOS 16.4+): open the Share menu, choose
                “Add to Home Screen”, then open Zilar from the home screen and enable below.
              </p>
            )}
            {onlyWhileOpen ? (
              <ThisDeviceCard
                state="Only while open"
                detail="Notifications show while a Zilar tab is open."
                enabled={false}
                busy={busy}
                errorMessage={cardError ? errorMessage : ''}
                onEnable={enableOnThisDevice}
                onDisable={disableOnThisDevice}
              />
            ) : (
              <ThisDeviceCard
                state={cardState}
                detail={cardDetail}
                enabled={thisDevice !== undefined}
                busy={busy}
                errorMessage={cardError ? errorMessage : ''}
                onEnable={enableOnThisDevice}
                onDisable={disableOnThisDevice}
              />
            )}
            <DevicesSection
              devices={devices}
              storedDevice={storedDevice}
              onRemove={removeOtherDevice}
            />
            <PreviewsSection showPreviews={showPreviews} onToggle={togglePreviews} />
            <section aria-label="Test" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionLabel>Test</SectionLabel>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => sendTest()}
                  disabled={testing || storedDevice === null}
                >
                  {testing ? 'Sending…' : 'Send a test notification'}
                </Button>
              </div>
              {testSent && (
                <p className="text-[14px] text-muted-foreground">
                  Sent — close this tab to see it.
                </p>
              )}
              {errorScope === 'test' && errorMessage !== '' && (
                <p role="alert" className="text-[14px] text-danger">
                  {errorMessage}
                </p>
              )}
            </section>
          </div>
        )}
        <MutedChatsSection />
      </div>
    </SettingsShell>
  );
}
