import { useEffect, useState } from 'react';
import { ApiError, listBlockedUsers, unblockUser, type BlockedPerson } from '@/lib/api';
import { refreshBlockedJids } from '@/lib/blockedJids';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';

/** Settings → Blocked people: who you blocked, with an Unblock per row. */
export function BlockedPage({ onBack }: { onBack: () => void }) {
  const [people, setPeople] = useState<BlockedPerson[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    listBlockedUsers()
      .then((blocked) => {
        if (active) {
          setPeople(blocked);
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

  const unblock = async (userId: string): Promise<void> => {
    setBusyId(userId);
    setError(undefined);
    try {
      await unblockUser(userId);
      setPeople((rows) => rows.filter((row) => row.userId !== userId));
      await refreshBlockedJids();
    } catch (unblockError) {
      setError(friendlyUnblockError(unblockError));
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <SettingsShell
      title="Blocked people"
      subtitle="They are not told. Their contact requests don't reach you."
      onBack={onBack}
    >
      <div className={SETTINGS_COLUMN}>
        {!loaded && <StateMessage kind="loading" title="Loading blocked people…" />}
        {loaded && people.length === 0 && error === undefined && (
          <StateMessage kind="empty" title="You haven't blocked anyone." />
        )}
        {people.length > 0 && (
          <Card>
            <ul className="divide-y divide-divider">
              {people.map((person) => (
                <li key={person.userId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <Avatar
                    id={person.userId}
                    name={person.name}
                    size={36}
                    avatarUrl={person.image ?? undefined}
                  />
                  <span className="min-w-0 flex-1 basis-40 text-[14px]">
                    <span className="block truncate text-[15px] font-medium">
                      {person.name}
                      {person.handle !== null && (
                        <span className="font-normal text-muted-foreground"> @{person.handle}</span>
                      )}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busyId === person.userId}
                    onClick={() => void unblock(person.userId)}
                  >
                    {busyId === person.userId ? 'Unblocking…' : 'Unblock'}
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
      </div>
    </SettingsShell>
  );
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'rate_limited') {
      return 'Too many tries — wait a little and try again.';
    }
    return 'Could not load blocked people. Try again.';
  }
  return 'Could not load blocked people. Try again.';
}

function friendlyUnblockError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'rate_limited') {
    return 'Too many tries — wait a little and try again.';
  }
  return 'Could not unblock. Try again.';
}
