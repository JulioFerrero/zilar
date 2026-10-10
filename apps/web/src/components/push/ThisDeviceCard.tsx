import { Bell, BellOff } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, SectionLabel } from '../ui/card';

/** The "This device" card: its push state and the Enable/Disable button. */
export function ThisDeviceCard({
  state,
  detail,
  enabled,
  busy,
  onEnable,
  onDisable,
}: {
  state: 'Enabled' | 'Not enabled' | 'Blocked by the browser';
  detail: string;
  enabled: boolean;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  return (
    <section aria-label="Notifications on this device" className="flex flex-col gap-2">
      <SectionLabel>This device</SectionLabel>
      <Card className="divide-divider">
        <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
          <span className="min-w-0 flex-1 basis-40">
            <span className="block text-[15px] font-medium">{state}</span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">{detail}</span>
          </span>
          {!enabled ? (
            <Button type="button" onClick={onEnable} disabled={busy}>
              <Bell className="size-4" aria-hidden="true" />
              {busy ? 'Enabling…' : 'Enable on this device'}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onDisable} disabled={busy}>
              <BellOff className="size-4" aria-hidden="true" />
              {busy ? 'Disabling…' : 'Disable'}
            </Button>
          )}
        </div>
      </Card>
    </section>
  );
}
