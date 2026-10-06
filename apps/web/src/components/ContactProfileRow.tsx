import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Ban, MessageSquare, UserCheck, UserMinus, UserPlus, UserX } from 'lucide-react';
import {
  ApiError,
  acceptContactRequest,
  blockUser,
  cancelContactRequest,
  declineContactRequest,
  listContactRequests,
  sendContactRequest,
  unblockUser,
  type HandleProfile,
} from '@/lib/api';
import { useChatStore } from '@/store/ChatStoreProvider';
import { refreshBlockedJids } from '@/lib/blockedJids';
import { Button } from '@/components/ui/button';
import { Avatar } from './Avatar';

/**
 * The shared profile row for an exact-handle lookup: avatar, name,
 * `@handle`, and one action per relation. Used by the Add contact dialog
 * and by the People section of the search results, so both behave the same.
 */
export function ContactProfileRow({
  profile,
  onRelationChange,
}: {
  profile: HandleProfile;
  onRelationChange: (profile: HandleProfile) => void;
}) {
  const navigate = useNavigate();
  const store = useChatStore();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  // Keyed by the parent on the profile id, so a different handle remounts
  // the row with fresh local state (no reset effect needed).

  const send = async (): Promise<void> => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const created = await sendContactRequest(profile.handle);
      if (created.incoming === true) {
        onRelationChange({ ...profile, relation: 'request_received' });
      } else {
        setSent(true);
      }
    } catch (sendError) {
      setError(friendlySendError(sendError));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (action: 'accept' | 'decline' | 'cancel'): Promise<void> => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (action === 'accept' || action === 'decline') {
        const list = await listContactRequests();
        const row = list.incoming.find((request) => request.other.userId === profile.userId);
        if (row === undefined) {
          setError('That request is no longer pending.');
          return;
        }
        if (action === 'accept') {
          await acceptContactRequest(row.id);
          onRelationChange({ ...profile, relation: 'contact' });
        } else {
          await declineContactRequest(row.id);
          onRelationChange({ ...profile, relation: 'none' });
        }
        return;
      }
      const list = await listContactRequests();
      const row = list.outgoing.find((request) => request.other.userId === profile.userId);
      if (row === undefined) {
        setError('That request is no longer pending.');
        return;
      }
      await cancelContactRequest(row.id);
      onRelationChange({ ...profile, relation: 'none' });
    } catch (decideError) {
      setError(friendlySendError(decideError));
    } finally {
      setBusy(false);
    }
  };

  const block = async (): Promise<void> => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await blockUser(profile.userId);
      setConfirmingBlock(false);
      onRelationChange({ ...profile, relation: 'blocked' });
      await refreshBlockedJids();
    } catch (blockError) {
      setError(friendlyBlockError(blockError, 'Could not block. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const unblock = async (): Promise<void> => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await unblockUser(profile.userId);
      onRelationChange({ ...profile, relation: 'none' });
      await refreshBlockedJids();
    } catch (unblockError) {
      setError(friendlyBlockError(unblockError, 'Could not unblock. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  // The DM chat id is the contact's JID; the lookup profile carries no
  // JID, so the row finds the DM two ways: the contact list (userId ->
  // jid) first, then a chat whose id matches that JID. No DM yet means no
  // Message button (only the status line shows).
  const dmChatId = (() => {
    const contact = store.contacts.find((entry) => entry.userId === profile.userId);
    if (contact === undefined) {
      return undefined;
    }
    return store.chats.some((chat) => chat.id === contact.jid) ? contact.jid : undefined;
  })();

  const openChat = (): void => {
    if (dmChatId !== undefined) {
      navigate(`/c/${encodeURIComponent(dmChatId)}`);
    }
  };

  const sentLabel = sent && profile.relation === 'none';

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-3">
        <Avatar
          id={profile.userId}
          name={profile.name}
          size={40}
          avatarUrl={profile.image ?? undefined}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">
            {profile.name}{' '}
            <span className="font-normal text-muted-foreground">@{profile.handle}</span>
          </p>
          {profile.relation === 'self' && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">That&apos;s you.</p>
          )}
          {profile.relation === 'contact' && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              You&apos;re already contacts.
            </p>
          )}
          {profile.relation === 'request_sent' && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Request already sent — they haven&apos;t answered yet.
            </p>
          )}
          {profile.relation === 'request_received' && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              They already asked to add you.
            </p>
          )}
          {profile.relation === 'blocked' && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">You blocked this person.</p>
          )}
          {sentLabel && <p className="mt-0.5 text-[13px] text-muted-foreground">Request sent.</p>}
        </div>
        {profile.relation === 'blocked' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void unblock()}
            disabled={busy}
            className="shrink-0"
          >
            {busy ? 'Unblocking…' : 'Unblock'}
          </Button>
        ) : profile.relation === 'self' ? null : profile.relation === 'contact' &&
          dmChatId !== undefined ? (
          <Button type="button" onClick={openChat} size="sm" className="shrink-0">
            <MessageSquare className="size-3.5" aria-hidden="true" />
            Message
          </Button>
        ) : profile.relation === 'none' ? (
          sentLabel ? (
            <span className="flex shrink-0 items-center gap-1.5 px-1 text-[13px] text-muted-foreground">
              <UserCheck className="size-3.5" aria-hidden="true" />
              Request sent
            </span>
          ) : (
            <Button
              type="button"
              onClick={() => void send()}
              disabled={busy}
              size="sm"
              className="shrink-0"
            >
              <UserPlus className="size-3.5" aria-hidden="true" />
              {busy ? 'Sending…' : 'Add contact'}
            </Button>
          )
        ) : profile.relation === 'request_sent' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void decide('cancel')}
            disabled={busy}
            className="shrink-0"
          >
            <UserMinus className="size-3.5" aria-hidden="true" />
            {busy ? 'Cancelling…' : 'Cancel'}
          </Button>
        ) : (
          <span className="flex shrink-0 gap-2">
            <Button type="button" onClick={() => void decide('accept')} disabled={busy} size="sm">
              <UserCheck className="size-3.5" aria-hidden="true" />
              Accept
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void decide('decline')}
              disabled={busy}
            >
              <UserX className="size-3.5" aria-hidden="true" />
              Decline
            </Button>
          </span>
        )}
      </div>
      {error !== undefined && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {confirmingBlock && profile.relation !== 'blocked' && profile.relation !== 'self' && (
        <div className="flex flex-col gap-2 rounded-lg bg-surface-raised px-3 py-2.5">
          <p className="text-[13px]">
            Block {profile.name}? They are not told. You won&apos;t see their contact requests.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void block()}
              disabled={busy}
              aria-label="Confirm block"
            >
              <Ban className="size-3.5" aria-hidden="true" />
              {busy ? 'Blocking…' : 'Block'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmingBlock(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {profile.relation !== 'self' && profile.relation !== 'blocked' && !confirmingBlock && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setError(undefined);
            setConfirmingBlock(true);
          }}
          className="self-start"
        >
          <Ban className="size-3.5" aria-hidden="true" />
          Block
        </Button>
      )}
    </div>
  );
}

function friendlySendError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'already_contact':
        return "You're already contacts.";
      case 'request_exists':
        return 'A request is already pending.';
      case 'blocked':
        return 'Unblock this person first.';
      case 'too_many_requests':
        return 'Too many pending requests — wait for some answers first.';
      case 'declined_recently':
        return 'They declined recently — try again in a few days.';
      case 'rate_limited':
        return 'Too many tries — wait a little and try again.';
      default:
        return 'Could not complete that action. Try again.';
    }
  }
  return 'Could not complete that action. Try again.';
}

function friendlyBlockError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.code === 'rate_limited') {
    return 'Too many tries — wait a little and try again.';
  }
  return fallback;
}
