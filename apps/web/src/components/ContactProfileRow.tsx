import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MessageSquare, UserCheck, UserMinus, UserPlus, UserX } from 'lucide-react';
import {
  ApiError,
  acceptContactRequest,
  cancelContactRequest,
  declineContactRequest,
  listContactRequests,
  sendContactRequest,
  type HandleProfile,
} from '@/lib/api';
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
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
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

  const openChat = (): void => {
    navigate(`/c/${encodeURIComponent(profile.userId)}`);
  };

  const sentLabel = sent && profile.relation === 'none';

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
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
          <p className="mt-0.5 text-[13px] text-muted-foreground">You&apos;re already contacts.</p>
        )}
        {profile.relation === 'request_sent' && (
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Request already sent — they haven&apos;t answered yet.
          </p>
        )}
        {profile.relation === 'request_received' && (
          <p className="mt-0.5 text-[13px] text-muted-foreground">They already asked to add you.</p>
        )}
        {sentLabel && <p className="mt-0.5 text-[13px] text-muted-foreground">Request sent.</p>}
      </div>
      {profile.relation === 'self' ? null : profile.relation === 'contact' ? (
        <button
          type="button"
          onClick={openChat}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-foreground hover:bg-accent/90"
        >
          <MessageSquare className="size-3.5" aria-hidden="true" />
          Message
        </button>
      ) : profile.relation === 'none' ? (
        sentLabel ? (
          <span className="flex shrink-0 items-center gap-1.5 px-1 text-[13px] text-muted-foreground">
            <UserCheck className="size-3.5" aria-hidden="true" />
            Request sent
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
          >
            <UserPlus className="size-3.5" aria-hidden="true" />
            {busy ? 'Sending…' : 'Add contact'}
          </button>
        )
      ) : profile.relation === 'request_sent' ? (
        <button
          type="button"
          onClick={() => void decide('cancel')}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-surface-raised disabled:opacity-60"
        >
          <UserMinus className="size-3.5" aria-hidden="true" />
          {busy ? 'Cancelling…' : 'Cancel'}
        </button>
      ) : (
        <span className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void decide('accept')}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
          >
            <UserCheck className="size-3.5" aria-hidden="true" />
            Accept
          </button>
          <button
            type="button"
            onClick={() => void decide('decline')}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-surface-raised disabled:opacity-60"
          >
            <UserX className="size-3.5" aria-hidden="true" />
            Decline
          </button>
        </span>
      )}
      {error !== undefined && (
        <p role="alert" className="mt-2 w-full text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function friendlyContactError(error: unknown): string {
  return friendlySendError(error);
}

function friendlySendError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'already_contact':
        return "You're already contacts.";
      case 'request_exists':
        return 'A request is already pending.';
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
