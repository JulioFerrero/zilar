import { describeUserAgent, formatListTime, formatShortDate } from '@zilar/chat-core';
import { makeDevicesApi, useDevices } from '@zilar/client-core';
import { useState } from 'react';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';
import type { AuthSession } from '@zilar/api-contract';
import { callApi } from '@/lib/effect/api-client';

// The list never carries a session token or an IP address.

const api = makeDevicesApi(callApi);

export function DevicesPage({ onBack }: { onBack: () => void }) {
  const {
    status,
    sessions,
    current,
    others,
    error,
    setError,
    signOut,
    signOutAll,
    busyIds,
    bulkBusy,
  } = useDevices(api);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);

  // Sign out all others loops over the delete route, one session each. allSettled never
  // rejects, so one failed revoke cannot stop the reload or leave the confirm open.
  const signOutOthers = (): void => {
    void signOutAll().finally(() => setConfirmingAll(false));
  };

  const loaded = status !== 'loading';

  const askRemove = (id: string): void => {
    setError('');
    setConfirmId(id);
  };

  return (
    <SettingsShell
      title="Devices"
      subtitle="Where you are signed in. Sign out a device you no longer use."
      onBack={onBack}
    >
      <div className={SETTINGS_COLUMN}>
        {!loaded && <StateMessage kind="loading" title="Loading devices…" />}
        {loaded && others.length > 0 && (
          <Card>
            <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <p className="min-w-0 flex-1 basis-40 text-[14px]">
                {confirmingAll
                  ? 'Sign out every other device?'
                  : `Signed in on ${others.length} other ${others.length === 1 ? 'device' : 'devices'}.`}
              </p>
              {confirmingAll ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={bulkBusy}
                    onClick={signOutOthers}
                  >
                    {bulkBusy ? 'Signing out…' : 'Sign out all'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingAll(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setError('');
                    setConfirmingAll(true);
                  }}
                >
                  Sign out all other devices
                </Button>
              )}
            </div>
          </Card>
        )}
        {loaded && sessions.length === 0 && error === '' && (
          <StateMessage kind="empty" title="No devices are signed in." />
        )}
        {loaded && sessions.length > 0 && (
          <Card>
            <ul className="divide-y divide-divider">
              {current !== undefined && <CurrentDeviceRow session={current} />}
              {others.map((session) => (
                <OtherDeviceRow
                  key={session.id}
                  session={session}
                  busy={busyIds.has(session.id)}
                  confirming={confirmId === session.id}
                  onAsk={() => askRemove(session.id)}
                  onCancel={() => setConfirmId(null)}
                  onSignOut={() => void signOut(session.id)}
                />
              ))}
            </ul>
          </Card>
        )}
        {error !== '' && (
          <p role="alert" className="text-[14px] text-danger">
            {error}
          </p>
        )}
      </div>
    </SettingsShell>
  );
}

function DeviceSummary({ session }: { session: AuthSession }) {
  const now = new Date();
  return (
    <span className="min-w-0 flex-1 basis-40 text-[14px]">
      <span className="block truncate text-[15px] font-medium">
        {describeUserAgent(session.userAgent)}
      </span>
      <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
        {`Last active ${formatListTime(new Date(session.updatedAt), now)} · Signed in ${formatShortDate(new Date(session.createdAt))}`}
      </span>
    </span>
  );
}

function CurrentDeviceRow({ session }: { session: AuthSession }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <DeviceSummary session={session} />
      <span className="shrink-0 rounded-full bg-badge-muted px-2 py-0.5 text-[11px] text-foreground">
        This device
      </span>
    </li>
  );
}

/** One other device with its own Sign out, so two rows can go at once. */
function OtherDeviceRow({
  session,
  busy,
  confirming,
  onAsk,
  onCancel,
  onSignOut,
}: {
  session: AuthSession;
  busy: boolean;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onSignOut: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <DeviceSummary session={session} />
      <div className="flex shrink-0 items-center gap-1">
        {confirming ? (
          <>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={onSignOut}
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={onAsk}>
            Sign out
          </Button>
        )}
      </div>
    </li>
  );
}
