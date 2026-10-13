// effect-plain: presentational request rows; the api layer owns the transport; a local undo timer only.
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { EntityAvatar } from '../EntityAvatar';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';
import {
  acceptContactRequest,
  declineContactRequest,
  getContacts,
  type ContactRequestView,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { useContactRequests } from '@/lib/useContactRequests';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

/** At most this many rows before the list collapses into "See all N requests". */
const MAX_ROWS = 3;
/** How long a declined row stays undoable before the decline reaches the server. */
const UNDO_MS = 5000;

const ACCEPT_FAILED = 'Could not accept that request. Try again.';
const DECLINE_FAILED = 'Could not decline that request. Try again.';

function without(id: string, ids: ReadonlySet<string>): ReadonlySet<string> {
  const next = new Set(ids);
  next.delete(id);
  return next;
}

/**
 * T-1336: one row per incoming contact request at the top of the chat list
 * (All chats and Personal, above the pinned chats), replacing the single
 * `ContactRequestsRow` link (WUX-19). Each row carries Accept and a Decline
 * icon; Accept adds the contact and opens the DM, Decline drops the row for a
 * 5-second Undo window before the call reaches the server. More than three
 * requests collapse into "See all N requests", which opens `/settings/requests`.
 */
export function RequestRows({ isWide }: { isWide: boolean }) {
  const activeFolderId = useChatSelector((s) => s.activeFolder);
  const folders = useChatSelector((s) => s.folders);
  const folder =
    activeFolderId === 'all' ? undefined : folders.find((entry) => entry.id === activeFolderId);
  // Requests are DMs, so they show in All chats and the Personal (dm) folder,
  // never in the AIs folder.
  const showRequests = folder === undefined || folder.includeTypes.includes('dm');
  const { requests, reload } = useContactRequests(showRequests);
  const refreshChats = useChatSelector((s) => s.refreshChats);
  const storeApi = useChatStoreApi();
  const navigate = useNavigate();
  const toast = useToast();

  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pendingDecline, setPendingDecline] = useState<ContactRequestView | undefined>(undefined);
  const timerRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef<ContactRequestView | undefined>(undefined);

  // Leaving the list ends the Undo window: the decline goes through at once.
  useEffect(
    () => () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
      }
      if (pendingRef.current !== undefined) {
        void declineContactRequest(pendingRef.current.id).catch(() => undefined);
      }
    },
    [],
  );

  const hide = (id: string): void => setHidden((ids) => new Set(ids).add(id));

  const accept = (request: ContactRequestView): void => {
    setError(undefined);
    setBusyId(request.id);
    void acceptContactRequest(request.id)
      .then(async () => {
        hide(request.id);
        // The DM already exists on the server for a new contact; refresh the
        // list so it lands at the top, then open it when its JID is known.
        refreshChats();
        toast(`${request.other.name} added`);
        let jid: string | undefined;
        try {
          const contacts = await getContacts();
          // Push the new contact into the store so the pickers that read it
          // (NewMessageDialog, the group add list) see them before the next
          // boot (finding 1).
          storeApi.setState({ contacts });
          jid = contacts.find((entry) => entry.userId === request.other.userId)?.jid;
        } catch {
          // The refreshed list shows the new chat at the top either way.
        }
        if (jid !== undefined) {
          navigate(`/c/${encodeURIComponent(jid)}`);
        }
      })
      .catch(() => setError(ACCEPT_FAILED))
      .finally(() => {
        setBusyId(undefined);
        reload();
      });
  };

  // The decline waits out the Undo window; the row is gone from the list at
  // once but the request still exists on the server until the timer fires.
  const commitDecline = (request: ContactRequestView): void => {
    pendingRef.current = undefined;
    setPendingDecline(undefined);
    void declineContactRequest(request.id)
      .then(() => reload())
      .catch(() => {
        setHidden((ids) => without(request.id, ids));
        setError(DECLINE_FAILED);
      });
  };

  const decline = (request: ContactRequestView): void => {
    setError(undefined);
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    // A second decline inside the Undo window commits the earlier one at once
    // rather than overwriting it and losing the call (finding 2).
    const previous = pendingRef.current;
    if (previous !== undefined) {
      commitDecline(previous);
    }
    hide(request.id);
    setPendingDecline(request);
    pendingRef.current = request;
    timerRef.current = window.setTimeout(() => commitDecline(request), UNDO_MS);
  };

  const undo = (): void => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
    }
    const request = pendingRef.current;
    pendingRef.current = undefined;
    setPendingDecline(undefined);
    if (request !== undefined) {
      setHidden((ids) => without(request.id, ids));
    }
  };

  if (!showRequests) {
    return null;
  }
  const visible = requests.filter((request) => !hidden.has(request.id));
  const shown = visible.slice(0, MAX_ROWS);

  return (
    <>
      {shown.length > 0 && (
        <ul aria-label="Contact requests" className="flex shrink-0 flex-col">
          {shown.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              isWide={isWide}
              busy={busyId === request.id}
              onAccept={() => accept(request)}
              onDecline={() => decline(request)}
            />
          ))}
        </ul>
      )}
      {visible.length > MAX_ROWS && (
        <Link
          to="/settings/requests"
          className={cn(
            'shrink-0 px-[10px] py-2 text-[14px] font-medium text-accent transition-colors hover:bg-list-hover',
            isWide && 'rounded-[12px]',
          )}
        >
          See all {visible.length} requests
        </Link>
      )}
      {pendingDecline !== undefined && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 px-[10px] py-2 text-[13px] text-muted-foreground"
        >
          <span>Declined</span>
          <button
            type="button"
            onClick={undo}
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            Undo
          </button>
        </div>
      )}
      {error !== undefined && (
        <p role="alert" className="shrink-0 px-[10px] py-2 text-[13px] text-danger">
          {error}
        </p>
      )}
    </>
  );
}

function RequestRow({
  request,
  isWide,
  busy,
  onAccept,
  onDecline,
}: {
  request: ContactRequestView;
  isWide: boolean;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { name, handle, userId } = request.other;
  const profile = (
    <>
      <EntityAvatar person={{ userId, name }} size={isWide ? 44 : 52} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-5 font-semibold text-foreground">
          {name}
        </span>
        <span className="block truncate text-[13px] leading-5 text-muted-foreground">
          {handle === null ? 'wants to add you' : `@${handle} wants to add you`}
        </span>
      </span>
    </>
  );
  return (
    <li className="flex shrink-0 items-center gap-3">
      {handle === null ? (
        <div
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3',
            isWide ? 'p-[10px]' : 'px-4 py-2.5',
          )}
        >
          {profile}
        </div>
      ) : (
        <Link
          to={`/u/${encodeURIComponent(handle)}`}
          aria-label={`Open ${name}'s profile`}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 transition-colors hover:bg-list-hover',
            isWide ? 'rounded-[12px] p-[10px]' : 'px-4 py-2.5',
          )}
        >
          {profile}
        </Link>
      )}
      <span className={cn('flex shrink-0 items-center gap-2', isWide ? 'pr-[10px]' : 'pr-4')}>
        <Button type="button" size="sm" disabled={busy} onClick={onAccept}>
          Accept
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Decline ${name}`}
          disabled={busy}
          onClick={onDecline}
        >
          <X aria-hidden="true" />
        </Button>
      </span>
    </li>
  );
}
