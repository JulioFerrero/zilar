import { Effect, Schedule } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ShieldCheck, Check, X } from 'lucide-react';
import { decideApproval, listApprovals, type PublicApproval } from '@/lib/api';
import {
  fromApi,
  isStaleDecision,
  type ApiFailure,
  useDelayed,
  failureOf,
  isWaiting,
} from '@zilar/client-core';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { FieldError } from '@/components/ais/AiPageShell';
import { StateMessage } from '@/components/ui/state-message';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { SKELETON_DELAY_MS } from '@/components/Skeleton';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/Avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';

interface ApprovalRowProps {
  approval: PublicApproval;
  busy: null | 'approve' | 'deny';
  actionError: string;
  onApprove: () => void;
  onDeny: () => void;
}

function ApprovalRow({ approval, busy, actionError, onApprove, onDeny }: ApprovalRowProps) {
  const disableButtons = busy !== null;
  const where =
    approval.groupName === null ? approval.aiName : `${approval.aiName} · ${approval.groupName}`;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3.5 px-4 py-3.5">
        <Avatar seed={approval.aiName} name={approval.aiName} size={32} />
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="truncate text-[15px] font-medium">{approval.summary}</span>
          {where !== '' && (
            <span className="truncate text-[13px] text-muted-foreground">{where}</span>
          )}
        </div>
        <IconButton
          aria-label={`Deny: ${approval.summary}`}
          disabled={disableButtons}
          onClick={onDeny}
        >
          <X size={16} />
        </IconButton>
        <IconButton
          variant="primary"
          aria-label={`Approve: ${approval.summary}`}
          disabled={disableButtons}
          onClick={onApprove}
        >
          <Check size={16} />
        </IconButton>
      </div>
      {actionError !== '' && (
        <div className="px-4 pb-3.5">
          <FieldError>{actionError}</FieldError>
        </div>
      )}
    </div>
  );
}

function ApprovalsListSkeleton({ rows = 2 }: { rows?: number }) {
  const visible = useDelayed(true, SKELETON_DELAY_MS) === true;
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (!visible) {
    return null;
  }
  return (
    <div role="status" aria-label="Loading approvals" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cn(
            'flex flex-col gap-2 rounded-xl border border-divider bg-surface p-4',
            !reduceMotion && 'animate-pulse',
            reduceMotion && 'skeleton-reduced',
          )}
        >
          <div className="h-5 w-40 rounded-full bg-surface-raised" />
          <div className="h-3.5 w-3/4 rounded-full bg-surface-raised" />
          <div className="h-3.5 w-2/3 rounded-full bg-surface-raised" />
          <div className="mt-1 h-3 w-32 rounded-full bg-surface-raised" />
          <div className="mt-2 flex gap-2">
            <div className="h-8 w-20 rounded-full bg-surface-raised" />
            <div className="h-8 w-16 rounded-full bg-surface-raised" />
          </div>
        </div>
      ))}
    </div>
  );
}

const REFRESH_INTERVAL_MS = 30_000;
const NOTICE_TIMEOUT_MS = 3000;
const STALE_NOTICE_TIMEOUT_MS = 5000;

export function ApprovalsPage() {
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');
  // Requests decided in this session: an in-flight list must not bring their rows back.
  const [decidedIds, setDecidedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [list, refresh] = useQuery(() => fromApi(() => listApprovals()), []);
  // The notice stays while its timer runs; a new notice replaces the timer.
  const [noticeTimer, startNoticeTimer] = useAction(
    (durationMs: number) => Effect.sleep(durationMs),
    { mode: 'replace' },
  );

  const showNotice = (message: string, durationMs: number): void => {
    setNotice(message);
    startNoticeTimer(durationMs);
  };
  const markDecided = (id: string): void => {
    setDecidedIds((ids) => new Set(ids).add(id));
  };

  // 30 s background refresh while the page is open; unmounting interrupts it.
  useQuery(
    () =>
      Effect.sync(() => refresh()).pipe(
        Effect.repeat(Schedule.spaced(REFRESH_INTERVAL_MS)),
        Effect.delay(REFRESH_INTERVAL_MS),
      ),
    [],
  );

  // Refresh on focus so coming back from another window picks up decisions made elsewhere.
  useEffect(() => {
    const onFocus = (): void => {
      refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const listFailure = isWaiting(list) ? undefined : failureOf(list);
  const status = AsyncResult.isSuccess(list) ? 'ready' : 'loading';
  const noticeVisible = notice !== '' && isWaiting(noticeTimer);
  const ordered = (AsyncResult.isSuccess(list) ? list.value : [])
    .filter((approval) => !decidedIds.has(approval.id))
    .sort((a, b) => {
      const left = new Date(a.createdAt).getTime();
      const right = new Date(b.createdAt).getTime();
      return right - left;
    });

  return (
    <SettingsShell title="Approvals" onBack={() => navigate('/settings')}>
      <div className={SETTINGS_COLUMN}>
        {status === 'ready' && ordered.length > 0 && (
          <section aria-label="Pending approvals" className="flex flex-col gap-2">
            <ul className="divide-y divide-divider overflow-hidden rounded-[12px] border border-divider bg-surface">
              {ordered.map((approval) => (
                <li key={approval.id}>
                  <PendingApproval
                    approval={approval}
                    onDecided={markDecided}
                    onNotice={showNotice}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {status === 'ready' && ordered.length === 0 && (
          <section aria-label="Pending approvals" className="flex flex-col gap-2">
            <StateMessage kind="empty" icon={ShieldCheck} title="Nothing is waiting for you." />
          </section>
        )}

        {noticeVisible && (
          <p role="status" className="text-[14px] text-muted-foreground">
            {notice}
          </p>
        )}

        {status === 'loading' && listFailure === undefined && <ApprovalsListSkeleton />}

        {listFailure !== undefined && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <FieldError>{listMessage(listFailure)}</FieldError>
            <Button type="button" size="lg" className="rounded-full px-5" onClick={() => refresh()}>
              Retry
            </Button>
          </div>
        )}
      </div>
    </SettingsShell>
  );
}

/** One pending request. Each row runs its own decision, so two rows can be decided at once. */
function PendingApproval({
  approval,
  onDecided,
  onNotice,
}: {
  approval: PublicApproval;
  onDecided: (id: string) => void;
  onNotice: (message: string, durationMs: number) => void;
}) {
  const [busy, setBusy] = useState<null | 'approve' | 'deny'>(null);
  const [decisionState, decide] = useAction((decision: 'approve' | 'deny') =>
    fromApi(() =>
      decideApproval(approval.id, decision === 'approve' ? 'approve_once' : 'deny'),
    ).pipe(
      Effect.tap((updated) =>
        Effect.sync(() => {
          onDecided(approval.id);
          onNotice(
            decision === 'approve'
              ? `Approved “${updated.action}”.`
              : `Denied “${updated.action}”.`,
            NOTICE_TIMEOUT_MS,
          );
        }),
      ),
      Effect.catchIf(isStaleDecision, () =>
        Effect.sync(() => {
          onDecided(approval.id);
          onNotice('That request was already decided or expired.', STALE_NOTICE_TIMEOUT_MS);
        }),
      ),
      Effect.ensuring(Effect.sync(() => setBusy(null))),
    ),
  );

  const start = (decision: 'approve' | 'deny'): void => {
    setBusy(decision);
    decide(decision);
  };
  const failure = isWaiting(decisionState) ? undefined : failureOf(decisionState);

  return (
    <ApprovalRow
      approval={approval}
      busy={busy}
      actionError={failure === undefined ? '' : decisionMessage(failure)}
      onApprove={() => start('approve')}
      onDeny={() => start('deny')}
    />
  );
}

function listMessage(failure: ApiFailure): string {
  return failure.code === 'unknown_error' ? 'Could not load your approvals.' : failure.message;
}

function decisionMessage(failure: ApiFailure): string {
  return failure.code === 'unknown_error' ? 'Could not send the decision.' : failure.message;
}
