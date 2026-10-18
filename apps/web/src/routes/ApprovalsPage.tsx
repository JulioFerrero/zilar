import { Effect, Schedule } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { decideApproval, listApprovals, type PublicApproval } from '@/lib/api';
import { fromApi, type ApiFailure } from '@zilar/client-core';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { Button, FieldError } from '@/components/ais/AiPageShell';
import { StateMessage } from '@/components/ui/state-message';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { ApprovalRow } from '@/components/approvals/ApprovalRow';
import { ApprovalsListSkeleton } from '@/components/approvals/ApprovalsListSkeleton';

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

function isStaleDecision(failure: ApiFailure): boolean {
  return failure.code === 'not_pending' || failure.code === 'expired';
}

function listMessage(failure: ApiFailure): string {
  return failure.code === 'unknown_error' ? 'Could not load your approvals.' : failure.message;
}

function decisionMessage(failure: ApiFailure): string {
  return failure.code === 'unknown_error' ? 'Could not send the decision.' : failure.message;
}
