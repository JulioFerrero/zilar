import { useEffect, useState } from 'react';
import {
  ApiError,
  acceptContactRequest,
  cancelContactRequest,
  declineContactRequest,
  listContactRequests,
  type ContactRequestView,
} from '@/lib/api';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';

/** Settings → Requests: incoming (Accept/Decline) and outgoing (Cancel). */
export function RequestsPage({ onBack }: { onBack: () => void }) {
  const [incoming, setIncoming] = useState<ContactRequestView[]>([]);
  const [outgoing, setOutgoing] = useState<ContactRequestView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    listContactRequests()
      .then((list) => {
        if (active) {
          setIncoming(list.incoming);
          setOutgoing(list.outgoing);
          setLoaded(true);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(friendlyError(loadError));
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const remove = (id: string): void => {
    setIncoming((rows) => rows.filter((row) => row.id !== id));
    setOutgoing((rows) => rows.filter((row) => row.id !== id));
  };

  const act = async (id: string, action: 'accept' | 'decline' | 'cancel'): Promise<void> => {
    setBusyId(id);
    setError(undefined);
    try {
      if (action === 'accept') {
        await acceptContactRequest(id);
      } else if (action === 'decline') {
        await declineContactRequest(id);
      } else {
        await cancelContactRequest(id);
      }
      remove(id);
    } catch (actionError) {
      setError(friendlyError(actionError));
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <SettingsShell title="Requests" subtitle="People who want to add you." onBack={onBack}>
      <div className={SETTINGS_COLUMN}>
        {!loaded && <p className="text-[14px] text-muted-foreground">Loading requests…</p>}
        {loaded && incoming.length === 0 && outgoing.length === 0 && (
          <p className="text-[14px] text-muted-foreground">No pending requests.</p>
        )}
        {incoming.length > 0 && (
          <section aria-label="Incoming requests" className="flex flex-col gap-2">
            <h2 className="text-[16px] font-semibold">Incoming</h2>
            <ul className="flex flex-col gap-2">
              {incoming.map((request) => (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1 basis-40 text-[14px]">
                    <span className="block truncate text-[15px] font-medium">
                      {request.other.name}{' '}
                      {request.other.handle !== null && (
                        <span className="font-normal text-muted-foreground">
                          @{request.other.handle}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === request.id}
                      onClick={() => void act(request.id, 'accept')}
                      className="rounded-full bg-accent px-3 py-1 text-[14px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={busyId === request.id}
                      onClick={() => void act(request.id, 'decline')}
                      className="rounded-full border border-border px-3 py-1 text-[14px] hover:bg-surface-raised disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {outgoing.length > 0 && (
          <section aria-label="Outgoing requests" className="flex flex-col gap-2">
            <h2 className="text-[16px] font-semibold">Sent</h2>
            <ul className="flex flex-col gap-2">
              {outgoing.map((request) => (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1 basis-40 text-[14px]">
                    <span className="block truncate text-[15px] font-medium">
                      {request.other.name}{' '}
                      {request.other.handle !== null && (
                        <span className="font-normal text-muted-foreground">
                          @{request.other.handle}
                        </span>
                      )}
                    </span>
                    <span className="text-[13px] text-muted-foreground">Waiting for an answer</span>
                  </span>
                  <button
                    type="button"
                    disabled={busyId === request.id}
                    onClick={() => void act(request.id, 'cancel')}
                    className="rounded-full border border-border px-3 py-1 text-[14px] hover:bg-surface-raised disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </section>
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

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'rate_limited') {
      return 'Too many tries — wait a little and try again.';
    }
    return error.message;
  }
  return 'Something went wrong. Try again.';
}
