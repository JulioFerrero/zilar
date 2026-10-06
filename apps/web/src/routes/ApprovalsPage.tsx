import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { ApiError, decideApproval, listApprovals, type PublicApproval } from '@/lib/api';
import { Button, FieldError } from '@/components/ais/AiPageShell';
import { StateMessage } from '@/components/ui/state-message';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { ApprovalRow } from '@/components/approvals/ApprovalRow';
import { ApprovalsListSkeleton } from '@/components/approvals/ApprovalsListSkeleton';
import { expiresInText } from '@/components/approvals/formatRelative';

type PageStatus = 'loading' | 'ready' | 'error';

interface RowState {
  approval: PublicApproval;
  busy: null | 'approve' | 'deny';
  error: string;
}

interface RowsById {
  [id: string]: RowState;
}

const REFRESH_INTERVAL_MS = 30_000;
const COUNTDOWN_TICK_MS = 60_000;
const NOTICE_TIMEOUT_MS = 3000;
const STALE_NOTICE_TIMEOUT_MS = 5000;

/**
 * Settings → Approvals. One inbox for every pending AI request the viewer
 * can decide, newest first, with Approve and Deny and no standing rules.
 */
export function ApprovalsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<PageStatus>('loading');
  const [rows, setRows] = useState<RowsById>({});
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState<Date>(() => new Date());
  const noticeTimer = useRef<number | null>(null);
  const mounted = useRef(true);
  // Requests decided in this session: a list response that was already in
  // flight when the decision landed must not bring their rows back.
  const decidedIds = useRef(new Set<string>());

  const showNotice = useCallback((message: string, durationMs: number): void => {
    setNotice(message);
    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = window.setTimeout(() => {
      setNotice('');
      noticeTimer.current = null;
    }, durationMs);
  }, []);

  const applyList = useCallback((list: PublicApproval[]): void => {
    if (!mounted.current) {
      return;
    }
    setRows((previous) => {
      const next: RowsById = {};
      for (const approval of list) {
        if (decidedIds.current.has(approval.id)) {
          continue;
        }
        const prior = previous[approval.id];
        next[approval.id] = {
          approval,
          busy: null,
          error: '',
          ...(prior === undefined ? {} : { busy: prior.busy, error: prior.error }),
        };
      }
      return next;
    });
    setStatus('ready');
    setErrorMessage('');
  }, []);

  const applyError = useCallback((error: unknown): void => {
    if (!mounted.current) {
      return;
    }
    setStatus('error');
    setErrorMessage(error instanceof Error ? error.message : 'Could not load your approvals.');
  }, []);

  const load = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) {
        setStatus('loading');
      }
      try {
        applyList(await listApprovals());
      } catch (error) {
        applyError(error);
      }
    },
    [applyList, applyError],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = null;
      }
    };
  }, []);

  // The first load. The status already starts as `loading`; the other
  // refreshes (focus, timer, buttons) go through `load`.
  useEffect(() => {
    listApprovals().then(applyList).catch(applyError);
  }, [applyList, applyError]);

  // Refresh when the tab regains focus so coming back from another window
  // picks up anything decided elsewhere.
  useEffect(() => {
    const onFocus = (): void => {
      void load(false);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  // 30 s background refresh while the page is open.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
      void load(false);
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [load]);

  // Also tick `now` every minute so the "expires in" countdown updates
  // without a full reload.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), COUNTDOWN_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const retry = (): void => {
    void load(true);
  };

  const refresh = (): void => {
    void load(false);
  };

  const decide = async (id: string, decision: 'approve' | 'deny'): Promise<void> => {
    setRows((previous) => {
      const current = previous[id];
      if (current === undefined) {
        return previous;
      }
      return { ...previous, [id]: { ...current, busy: decision, error: '' } };
    });
    try {
      const updated = await decideApproval(id, decision === 'approve' ? 'approve_once' : 'deny');
      decidedIds.current.add(id);
      if (!mounted.current) {
        return;
      }
      setRows((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      showNotice(
        decision === 'approve' ? `Approved “${updated.action}”.` : `Denied “${updated.action}”.`,
        NOTICE_TIMEOUT_MS,
      );
    } catch (error) {
      if (!mounted.current) {
        return;
      }
      if (error instanceof ApiError && (error.code === 'not_pending' || error.code === 'expired')) {
        decidedIds.current.add(id);
        setRows((previous) => {
          const next = { ...previous };
          delete next[id];
          return next;
        });
        showNotice('That request was already decided or expired.', STALE_NOTICE_TIMEOUT_MS);
        return;
      }
      const message = error instanceof Error ? error.message : 'Could not send the decision.';
      setRows((previous) => {
        const current = previous[id];
        if (current === undefined) {
          return previous;
        }
        return { ...previous, [id]: { ...current, busy: null, error: message } };
      });
    }
  };

  const ordered = Object.values(rows).sort((a, b) => {
    const left = new Date(a.approval.createdAt).getTime();
    const right = new Date(b.approval.createdAt).getTime();
    return right - left;
  });

  return (
    <SettingsShell
      title="Approvals"
      subtitle="Requests from your AIs that are waiting for you."
      onBack={() => navigate('/')}
    >
      <div className={SETTINGS_COLUMN}>
        {status === 'ready' && ordered.length > 0 && (
          <section aria-label="Pending approvals" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[16px] font-semibold">Waiting for you</h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-full px-3"
                onClick={refresh}
              >
                Refresh
              </Button>
            </div>

            <ul className="flex flex-col gap-2">
              {ordered.map((row) => (
                <li key={row.approval.id}>
                  <ApprovalRow
                    approval={row.approval}
                    expiresIn={expiresInText(row.approval.expiresAt, now)}
                    busy={row.busy}
                    actionError={row.error}
                    onApprove={() => void decide(row.approval.id, 'approve')}
                    onDeny={() => void decide(row.approval.id, 'deny')}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {status === 'ready' && ordered.length === 0 && (
          <section aria-label="Pending approvals" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[16px] font-semibold">Waiting for you</h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-full px-3"
                onClick={refresh}
              >
                Refresh
              </Button>
            </div>
            <StateMessage kind="empty" icon={ShieldCheck} title="Nothing is waiting for you." />
          </section>
        )}

        {notice !== '' && (
          <p role="status" className="text-[14px] text-muted-foreground">
            {notice}
          </p>
        )}

        {status === 'loading' && <ApprovalsListSkeleton />}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <FieldError>{errorMessage}</FieldError>
            <Button type="button" size="lg" className="rounded-full px-5" onClick={retry}>
              Retry
            </Button>
          </div>
        )}
      </div>
    </SettingsShell>
  );
}
