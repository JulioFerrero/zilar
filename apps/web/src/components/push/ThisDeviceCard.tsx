import { Bell, BellOff } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, SectionLabel } from '../ui/card';

const BLOCKED_DETAIL =
  "Notifications are blocked for this site. Allow them in the browser's site settings, then reload.";

/** The "This device" card: its push state and the Enable/Disable button. */
export function ThisDeviceCard({
  state,
  detail,
  enabled,
  busy,
  errorMessage = '',
  onEnable,
  onDisable,
}: {
  state: 'Enabled' | 'Not enabled' | 'Blocked by the browser';
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
