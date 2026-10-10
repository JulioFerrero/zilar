import { useNavigate } from 'react-router';
import { isIosDevice, isStandaloneDisplay } from '@/lib/push';
import { usePushEnable } from '@/lib/push/usePushEnable';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { DevicesSection } from '@/components/push/DevicesSection';
import { PreviewsSection } from '@/components/push/PreviewsSection';
import { ThisDeviceCard } from '@/components/push/ThisDeviceCard';
import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';

/** Settings → Notifications. Enable on this device, devices, previews, test. */
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
    errorMessage,
    enableOnThisDevice,
    disableOnThisDevice,
    removeOtherDevice,
    togglePreviews,
    sendTest,
  } = usePushEnable();

  const thisDevice =
    storedDevice === null ? undefined : devices.find((entry) => entry.id === storedDevice.id);
  // The "This device" card names the state in words (T-0153): the support
  // check already splits unsupported browsers and servers into their own
  // page states above, so here only permission and registration remain.
  const deviceState: 'Enabled' | 'Not enabled' | 'Blocked by the browser' =
    thisDevice !== undefined
      ? 'Enabled'
      : permission === 'denied'
        ? 'Blocked by the browser'
        : 'Not enabled';
  const deviceStateDetail =
    thisDevice !== undefined
      ? thisDevice.inactive
        ? 'On, but inactive — nothing received in 90 days.'
        : 'Push is on for this device.'
      : permission === 'denied'
        ? 'Allow notifications for this site in the browser settings, then come back and enable.'
        : 'Turn on push for this browser.';
  const showIosHint =
    status === 'ready' &&
    isIosDevice() &&
    !isStandaloneDisplay({
      matchMedia: (query) => window.matchMedia(query),
      standalone: (window.navigator as { standalone?: boolean }).standalone,
    });

  return (
    <SettingsShell
      title="Notifications"
      subtitle="Push this device when a message arrives."
      onBack={() => navigate('/')}
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
            <ThisDeviceCard
              state={deviceState}
              detail={deviceStateDetail}
              enabled={thisDevice !== undefined}
              busy={busy}
              onEnable={enableOnThisDevice}
              onDisable={disableOnThisDevice}
            />
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
            </section>
            {errorMessage !== '' && (
              <p role="alert" className="text-[14px] text-danger">
                {errorMessage}
              </p>
            )}
          </div>
        )}
      </div>
    </SettingsShell>
  );
}
