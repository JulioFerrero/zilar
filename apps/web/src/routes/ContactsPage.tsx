import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MoreHorizontal } from 'lucide-react';
import { getContacts, removeContact, type Contact } from '@/lib/api/chats';
import { useAuth } from '@/auth/AuthProvider';
import { copyText } from '@/lib/clipboard';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { isWaiting, shownFailure, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { EntityAvatar } from '@/components/EntityAvatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, MenuItem } from '@/components/ui/menu';
import { StateMessage } from '@/components/ui/state-message';

/**
 * Settings → Contacts (T-1233): the people you can chat with. A row opens the
 * DM; each row's menu removes the contact after an in-page confirm. The copy
 * button at the top is the same personal link the profile page shows
 * (`ProfileSettingsSection`, the `shareUrl` built from the caller's `@handle`).
 */
export function ContactsPage({ onBack }: { onBack: () => void }) {
  const auth = useAuth();
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [removeError, setRemoveError] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [contacts] = useQuery(() => fromApi(() => getContacts()), []);

  const [, copyShare] = useAction((url: string) =>
    Effect.tryPromise(() => copyText(url)).pipe(
      Effect.tap(() => Effect.sync(() => setCopied(true))),
    ),
  );

  // The profile page's link, byte for byte (T-0163): the host plus `/@handle`.
  const shareUrl =
    typeof window === 'undefined' || (auth.user?.handle ?? null) === null
      ? null
      : `${window.location.origin}/@${encodeURIComponent(auth.user?.handle ?? '')}`;

  const loaded = AsyncResult.isNotInitial(contacts);
  const people = (AsyncResult.isSuccess(contacts) ? contacts.value : [])
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const visibleCount = people.filter((person) => !removedIds.has(person.userId)).length;
  const loadFailure = shownFailure(contacts);
  const error = loadFailure !== undefined ? friendlyError(loadFailure) : removeError;

  const markRemoved = (userId: string): void => {
    setRemovedIds((ids) => new Set(ids).add(userId));
  };

  return (
    <SettingsShell
      title="Contacts"
      subtitle="The people you can chat with. Open a chat, or remove one."
      onBack={onBack}
    >
      <div className={SETTINGS_COLUMN}>
        {shareUrl !== null && (
          <Button type="button" variant="outline" onClick={() => copyShare(shareUrl)}>
            {copied ? 'Copied' : 'Copy my profile link'}
          </Button>
        )}
        {!loaded && <StateMessage kind="loading" title="Loading contacts…" />}
        {loaded && visibleCount === 0 && error === undefined && (
          <StateMessage kind="empty" title="You don't have any contacts yet." />
        )}
        {visibleCount > 0 && (
          <Card>
            <ul className="divide-y divide-divider">
              {people.map((person) => (
                <ContactRow
                  key={person.userId}
                  person={person}
                  removed={removedIds.has(person.userId)}
                  onRemoved={markRemoved}
                  onError={setRemoveError}
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

/**
 * One contact: the avatar and name open the DM; the menu's Remove asks first
 * in place, then calls the remove route. A removed row returns nothing but
 * stays mounted: the chat-list refresh after the removal still runs to the
 * end, and an unmount would cancel it (the same shape as `BlockedPage`).
 */
function ContactRow({
  person,
  removed,
  onRemoved,
  onError,
}: {
  person: Contact;
  removed: boolean;
  onRemoved: (userId: string) => void;
  onError: (message: string | undefined) => void;
}) {
  const navigate = useNavigate();
  const storeApi = useChatStoreApi();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [state, runRemove] = useAction((userId: string) =>
    fromApi(() => removeContact(userId)).pipe(
      Effect.tap(() => Effect.sync(() => onRemoved(userId))),
      // The chat list holds this person's DM row; refresh it with the store's
      // own action, the one `JoinRoute` and `ContactProfileRow` call.
      Effect.tap(() => Effect.sync(() => storeApi.getState().refreshChats())),
      Effect.tapError((failure) => Effect.sync(() => onError(friendlyRemoveError(failure)))),
    ),
  );
  if (removed) {
    return null;
  }
  const busy = isWaiting(state);
  const startRemove = (): void => {
    if (busy) {
      return;
    }
    onError(undefined);
    runRemove(person.userId);
  };

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(`/c/${encodeURIComponent(person.jid)}`)}
          className="flex min-w-0 flex-1 basis-40 items-center gap-3 text-left"
          aria-label={`Open the chat with ${person.name}`}
        >
          <EntityAvatar person={person} size={36} />
          <span className="min-w-0 flex-1 text-[14px]">
            <span className="block truncate text-[15px] font-medium">
              {person.name}
              {person.handle !== undefined && person.handle !== null && (
                <span className="font-normal text-muted-foreground"> @{person.handle}</span>
              )}
            </span>
          </span>
        </button>
        <div className="relative">
          <Menu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            label="Contact actions"
            align="end"
            trigger={
              <IconButton aria-label={`Actions for ${person.name}`} size={32} radius={8}>
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </IconButton>
            }
          >
            <MenuItem
              destructive
              onSelect={() => {
                setMenuOpen(false);
                setConfirming(true);
              }}
            >
              Remove contact
            </MenuItem>
          </Menu>
        </div>
      </div>
      {confirming && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg bg-surface-raised px-3 py-2.5">
          <p className="text-[13px]">
            Remove {person.name}? They stay in your chats; you stop being contacts.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={startRemove}
              disabled={busy}
              aria-label="Confirm remove contact"
            >
              {busy ? 'Removing…' : 'Remove'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function friendlyError(error: ApiFailure): string {
  if (error.code === 'rate_limited') {
    return 'Too many tries — wait a little and try again.';
  }
  return 'Could not load contacts. Try again.';
}

function friendlyRemoveError(error: ApiFailure): string {
  if (error.code === 'rate_limited') {
    return 'Too many tries — wait a little and try again.';
  }
  if (error.status === 404) {
    return 'That person is no longer a contact.';
  }
  return 'Could not remove contact. Try again.';
}
