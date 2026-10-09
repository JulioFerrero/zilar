import { Data, Effect } from 'effect';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Ban, MessageSquare, UserCheck, UserMinus, UserPlus, UserX } from 'lucide-react';
import {
  acceptContactRequest,
  blockUser,
  cancelContactRequest,
  declineContactRequest,
  listContactRequests,
  sendContactRequest,
  unblockUser,
  type HandleProfile,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStore } from '@/store/ChatStoreProvider';
import { refreshBlockedJids } from '@/lib/blockedJids';
import { Button } from '@/components/ui/button';
import { Avatar } from './Avatar';

type RowAction = 'send' | 'accept' | 'decline' | 'cancel' | 'block' | 'unblock';

/** The request was answered or withdrawn before this click (another tab, or the other side). */
class RequestGone extends Data.TaggedError('RequestGone') {}

type RowFailure = ApiFailure | RequestGone;

/** Finds this person's pending request in one direction, then runs `act` on it. */
function onPendingRequest(
  userId: string,
  direction: 'incoming' | 'outgoing',
  act: (requestId: string) => Effect.Effect<unknown, ApiFailure>,
): Effect.Effect<void, RowFailure> {
  return Effect.gen(function* () {
    const list = yield* fromApi(() => listContactRequests());
    const row = list[direction].find((request) => request.other.userId === userId);
    if (row === undefined) {
      return yield* new RequestGone();
    }
    yield* act(row.id);
  });
}

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
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  // Keyed by the parent on the profile id, so a different handle remounts
  // the row with fresh local state (no reset effect needed).

  // One action for every button of this row: the buttons share one busy
  // flag and one error line, so a second click (on any button) waits.
  const relationChange = (relation: HandleProfile['relation']) =>
    Effect.sync(() => onRelationChange({ ...profile, relation }));

  const perform = (action: RowAction): Effect.Effect<void, RowFailure> => {
    switch (action) {
      case 'send':
        return fromApi(() => sendContactRequest(profile.handle)).pipe(
          Effect.tap((created) =>
            Effect.sync(() => {
              if (created.incoming === true) {
                onRelationChange({ ...profile, relation: 'request_received' });
              } else {
                setSent(true);
              }
            }),
          ),
          Effect.asVoid,
        );
      case 'accept':
        return onPendingRequest(profile.userId, 'incoming', (id) =>
          fromApi(() => acceptContactRequest(id)),
        ).pipe(Effect.andThen(relationChange('contact')));
      case 'decline':
        return onPendingRequest(profile.userId, 'incoming', (id) =>
          fromApi(() => declineContactRequest(id)),
        ).pipe(Effect.andThen(relationChange('none')));
      case 'cancel':
        return onPendingRequest(profile.userId, 'outgoing', (id) =>
          fromApi(() => cancelContactRequest(id)),
        ).pipe(Effect.andThen(relationChange('none')));
      case 'block':
        return fromApi(() => blockUser(profile.userId)).pipe(
          Effect.andThen(
            Effect.sync(() => {
              setConfirmingBlock(false);
              onRelationChange({ ...profile, relation: 'blocked' });
            }),
          ),
          Effect.andThen(fromApi(() => refreshBlockedJids())),
        );
      case 'unblock':
        return fromApi(() => unblockUser(profile.userId)).pipe(
          Effect.andThen(relationChange('none')),
          Effect.andThen(fromApi(() => refreshBlockedJids())),
        );
    }
  };

  const [state, runAction] = useAction((action: RowAction) =>
    perform(action).pipe(
      Effect.tapError((failure) => Effect.sync(() => setError(rowErrorText(action, failure)))),
    ),
  );
  const busy = isWaiting(state);
  const startAction = (action: RowAction): void => {
    if (busy) {
      return;
    }
    setError(undefined);
    runAction(action);
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
            onClick={() => startAction('unblock')}
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
              onClick={() => startAction('send')}
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
            onClick={() => startAction('cancel')}
            disabled={busy}
            className="shrink-0"
          >
            <UserMinus className="size-3.5" aria-hidden="true" />
            {busy ? 'Cancelling…' : 'Cancel'}
          </Button>
        ) : (
          <span className="flex shrink-0 gap-2">
            <Button type="button" onClick={() => startAction('accept')} disabled={busy} size="sm">
              <UserCheck className="size-3.5" aria-hidden="true" />
              Accept
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => startAction('decline')}
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
              onClick={() => startAction('block')}
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

function rowErrorText(action: RowAction, failure: RowFailure): string {
  if (failure._tag === 'RequestGone') {
    return 'That request is no longer pending.';
  }
  switch (action) {
    case 'block':
      return friendlyBlockError(failure, 'Could not block. Try again.');
    case 'unblock':
      return friendlyBlockError(failure, 'Could not unblock. Try again.');
    default:
      return friendlySendError(failure);
  }
}

function friendlySendError(error: ApiFailure): string {
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

function friendlyBlockError(error: ApiFailure, fallback: string): string {
  if (error.code === 'rate_limited') {
    return 'Too many tries — wait a little and try again.';
  }
  return fallback;
}
