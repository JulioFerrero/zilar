import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { describeUserAgent, formatListTime, formatShortDate } from '@zilar/chat-core';
import { listSessions, revokeSession, type AuthSession } from '@/lib/api/devices';
import { fromApi } from '@/lib/effect/api-effect';
import { isWaiting, shownFailure, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';

const SIGN_OUT_ERROR = 'Could not sign out. Try again.';
const LOAD_ERROR = 'Could not load your devices. Try again.';

/** Settings → Devices: every signed-in session, with a Sign out per other one. */
export function DevicesPage({ onBack }: { onBack: () => void }) {
  const [devices, refresh] = useQuery(() => fromApi(() => listSessions()), []);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  // "Sign out all other devices" loops over the list: the delete route already
  // removes one session, so no third route is needed. `allSettled` never
  // rejects, so one failed revoke cannot stop the list reload or leave the
  // confirm open; the error line shows only when a revoke failed.
  const [bulkState, signOutOthers] = useAction((ids: string[]) =>
    fromApi(() => Promise.allSettled(ids.map((id) => revokeSession(id)))).pipe(
      Effect.tap((results) =>
        Effect.sync(() => {
          const failed = results.some((result) => result.status === 'rejected');
          setActionError(failed ? SIGN_OUT_ERROR : undefined);
          setConfirmingAll(false);
          refresh();
        }),
      ),
    ),
  );

  const loaded = AsyncResult.isNotInitial(devices);
  const sessions = AsyncResult.isSuccess(devices) ? devices.value.sessions : [];
  const current = sessions.find((session) => session.current);
  const otherSessions = sessions.filter((session) => !session.current);
  const visibleOthers = otherSessions.filter((session) => !removedIds.has(session.id));
  const loadFailure = shownFailure(devices);
  const error = loadFailure !== undefined ? LOAD_ERROR : actionError;

  const markRemoved = (id: string): void => {
    setRemovedIds((ids) => new Set(ids).add(id));
  };
  const askRemove = (id: string): void => {
    setActionError(undefined);
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
        {loaded && visibleOthers.length > 0 && (
          <Card>
            <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <p className="min-w-0 flex-1 basis-40 text-[14px]">
                {confirmingAll
                  ? 'Sign out every other device?'
                  : `Signed in on ${visibleOthers.length} other ${visibleOthers.length === 1 ? 'device' : 'devices'}.`}
              </p>
              {confirmingAll ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={isWaiting(bulkState)}
                    onClick={() => signOutOthers(visibleOthers.map((session) => session.id))}
                  >
                    {isWaiting(bulkState) ? 'Signing out…' : 'Sign out all'}
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
                    setActionError(undefined);
                    setConfirmingAll(true);
                  }}
                >
                  Sign out all other devices
                </Button>
              )}
            </div>
          </Card>
        )}
        {loaded && sessions.length === 0 && error === undefined && (
          <StateMessage kind="empty" title="No devices are signed in." />
        )}
        {loaded && sessions.length > 0 && (
          <Card>
            <ul className="divide-y divide-divider">
              {current !== undefined && <CurrentDeviceRow session={current} />}
              {otherSessions.map((session) => (
                <OtherDeviceRow
                  key={session.id}
                  session={session}
                  removed={removedIds.has(session.id)}
                  confirming={confirmId === session.id}
                  onAsk={() => askRemove(session.id)}
                  onCancel={() => setConfirmId(null)}
                  onRemoved={markRemoved}
                  onError={setActionError}
                />
              ))}
            </ul>
          </Card>
        )}
        {error !== undefined && (
          <p role="alert" className="text-[14px] text-danger">
            {error}
          </p>
        )}
      </div>
    </SettingsShell>
  );
}

/** The line every row shows: a parsed device and the two timestamps. */
function DeviceSummary({ session }: { session: AuthSession }) {
  const now = new Date();
  // The labels come from chat-core's date helpers (packages/chat-core/src/format.ts):
  // `formatListTime` for "Last active", `formatShortDate` for "Signed in".
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

/** This browser's own session: labelled, with no Sign out. */
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

/**
 * One other device with its own Sign out, so two rows can be signed out at
 * once; a second click on the same row waits for the first. A removed row
 * returns nothing but stays mounted, like BlockedPage's.
 */
function OtherDeviceRow({
  session,
  removed,
  confirming,
  onAsk,
  onCancel,
  onRemoved,
  onError,
}: {
  session: AuthSession;
  removed: boolean;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onRemoved: (id: string) => void;
  onError: (message: string | undefined) => void;
}) {
  const [state, revoke] = useAction((id: string) =>
    fromApi(() => revokeSession(id)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          onRemoved(session.id);
          onError(undefined);
        }),
      ),
      Effect.tapError(() => Effect.sync(() => onError(SIGN_OUT_ERROR))),
    ),
  );
  if (removed) {
    return null;
  }
  const busy = isWaiting(state);

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
              onClick={() => revoke(session.id)}
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
