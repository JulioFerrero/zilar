import { useNavigate } from 'react-router';
import { Bell } from 'lucide-react';
import { isIosDevice, isStandaloneDisplay } from '@/lib/push';
import { usePushEnable } from '@/lib/push/usePushEnable';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { DevicesSection } from '@/components/push/DevicesSection';
import { MutedChatsSection } from '@/components/push/MutedChatsSection';
import { PreviewsSection } from '@/components/push/PreviewsSection';
import { ThisDeviceCard } from '@/components/push/ThisDeviceCard';
import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';

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
          <section aria-label="Notifications on this device" className="flex flex-col gap-2">
            <SectionLabel>This device</SectionLabel>
            <Card className="divide-divider">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block text-[15px] font-medium">Not supported</span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    Push notifications are not supported in this browser. Try a recent Chrome, Edge,
                    Firefox or Safari.
                  </span>
                </span>
              </div>
            </Card>
          </section>
        )}
        {status === 'server-off' && (
          <section aria-label="Notifications on this device" className="flex flex-col gap-2">
            <SectionLabel>This device</SectionLabel>
            <Card className="divide-divider">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block text-[15px] font-medium">Not available</span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    Push notifications are not enabled on this server yet.
                  </span>
                </span>
              </div>
            </Card>
          </section>
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
              <section aria-label="Notifications on this device" className="flex flex-col gap-2">
                <SectionLabel>This device</SectionLabel>
                <Card className="divide-divider">
                  <div className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="min-w-0 flex-1 basis-40">
                        <span className="block text-[15px] font-medium">Only while open</span>
                        <span className="mt-0.5 block text-[13px] text-muted-foreground">
                          Notifications show while a Zilar tab is open.
                        </span>
                      </span>
                      <Button type="button" onClick={enableOnThisDevice} disabled={busy}>
                        <Bell className="size-4" aria-hidden="true" />
                        {busy ? 'Enabling…' : 'Enable on this device'}
                      </Button>
                    </div>
                    {cardError && (
                      <p role="alert" className="mt-2 text-[14px] text-danger">
                        {errorMessage}
                      </p>
                    )}
                  </div>
                </Card>
              </section>
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
