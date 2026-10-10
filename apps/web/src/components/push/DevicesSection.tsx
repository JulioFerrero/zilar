import { type PushDevice } from '@/lib/api';
import type { StoredDevice } from '@/lib/push/deviceStorage';
import { Button } from '../ui/button';
import { Card, SectionLabel } from '../ui/card';

/** The registered devices list, with a Remove button per row. */
export function DevicesSection({
  devices,
  storedDevice,
  onRemove,
}: {
  devices: PushDevice[];
  storedDevice: StoredDevice | null;
  onRemove: (id: string) => void;
}) {
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
                    {device.userAgent ?? 'Unknown device'}
                    {storedDevice !== null && device.id === storedDevice.id ? ' (this device)' : ''}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    Added {new Date(device.createdAt).toLocaleDateString()}
                    {device.inactive ? ' · inactive' : ''}
                  </p>
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
