import { useEffect, useRef, useState } from 'react';
import {
  listAiApprovalRules,
  listGroupApprovalRules,
  revokeApprovalRule,
  ApiError,
  type ApprovalRule,
  type GroupDetail,
} from '@/lib/api';
import { useChatStore } from '@/store/ChatStoreProvider';
import { Button, FieldError } from '@/components/ais/AiPageShell';

// T-0100: whose rules to list. Mirrors `AuditScope` in AiActivity: exactly
// one of the two keys, and the callers guard their own mounting (the AI
// panel mounts it for the AI owner, the group panel for owners/admins).
// T-0111: the topic panel passes `topicId` to show one topic's rows only;
// the subtitle names the topic (rows show `Group › Topic` there).
export type AlwaysAllowedScope = { aiId: string } | { groupId: string };

function scopeKeyOf(scope: AlwaysAllowedScope, topicId?: string): string {
  const base = 'aiId' in scope ? `ai:${scope.aiId}` : `group:${scope.groupId}`;
  return topicId === undefined ? base : `${base}#${topicId}`;
}

function loadScopeRules(scope: AlwaysAllowedScope): Promise<ApprovalRule[]> {
  return 'aiId' in scope ? listAiApprovalRules(scope.aiId) : listGroupApprovalRules(scope.groupId);
}

/**
 * Resolves a rule's group id to the chat title when the store knows it.
 * Group details are keyed by chat id with the group's id inside, so the
 * lookup walks the known details; unknown ids fall back to plain words.
 * T-0111: a rule with a `topicName` shows `Group › Topic`.
 */
export function scopeTextFor(
  rule: ApprovalRule,
  groupInfos: Record<string, GroupDetail>,
  topicName?: string | null,
): string {
  const name = topicName ?? rule.topicName ?? undefined;
  if (rule.scope === 'personal' || rule.groupId === null) {
    return name === undefined || name === '' ? 'Personal chat' : `Personal chat › ${name}`;
  }
  for (const info of Object.values(groupInfos)) {
    if (info.id === rule.groupId) {
      return name === undefined || name === '' ? `In ${info.title}` : `In ${info.title} › ${name}`;
    }
  }
  return name === undefined || name === '' ? 'In a group' : `In a group › ${name}`;
}

type ListStatus = 'loading' | 'ready' | 'error';

interface RulesListState {
  status: ListStatus;
  rules: ApprovalRule[];
  message: string;
}

/**
 * The "Always allowed" list (T-0100): the standing approval rules for one
 * AI or one group, with a one-step revoke per row. Shared by the AI panel
 * and the group panel. Loads once when mounted; never renders blank —
 * loading, empty and error each get their own copy, and a failed load
 * offers Retry. Revoke removes the row on success (a 404 means it is
 * already gone, so the row drops quietly); any other failure keeps the
 * row and shows an inline error.
 */
export function AlwaysAllowedList({
  scope,
  topicId,
  topicName,
  readOnly = false,
}: {
  scope: AlwaysAllowedScope;
  /** T-0111: when set, only this topic's rows show and Revoke hides. */
  topicId?: string;
  /** T-0111: the topic's display name for the row subtitles. */
  topicName?: string;
  /** T-0111: the topic panel reads the list without revoke actions. */
  readOnly?: boolean;
}) {
  const { groupInfos } = useChatStore();
  const [state, setState] = useState<RulesListState>({ status: 'loading', rules: [], message: '' });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  const scopeKey = scopeKeyOf(scope, topicId);
  // A ref tracks the latest scope so the effect body can spread it without
  // re-running on every render: callers pass a fresh `{ aiId }` / `{
  // groupId }` literal each render, and including `scope` in the deps would
  // loop. Same shape as `ActivitySection`.
  const scopeRef = useRef<AlwaysAllowedScope>(scope);
  const topicIdRef = useRef<string | undefined>(topicId);
  useEffect(() => {
    scopeRef.current = scope;
    topicIdRef.current = topicId;
  });

  // Reset to `loading` while rendering (not inside the effect body): when
  // the scope or the retry tick changed this render, the previous key is
  // still in `lastLoadKey`, so we drop the stale list at once. Same shape
  // as the polling hook's reset — the repo's lint forbids setState in an
  // effect body.
  const loadKey = `${scopeKey}#${refreshTick}`;
  const [lastLoadKey, setLastLoadKey] = useState(loadKey);
  if (lastLoadKey !== loadKey) {
    setLastLoadKey(loadKey);
    setState({ status: 'loading', rules: [], message: '' });
  }

  useEffect(() => {
    let active = true;
    const onlyTopic = topicIdRef.current;
    void loadScopeRules(scopeRef.current).then(
      (rules) => {
        if (active) {
          setState({
            status: 'ready',
            rules:
              onlyTopic === undefined ? rules : rules.filter((rule) => rule.topicId === onlyTopic),
            message: '',
          });
        }
      },
      (error: unknown) => {
        if (active) {
          setState({
            status: 'error',
            rules: [],
            message: error instanceof Error ? error.message : 'Could not load the rules.',
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [scopeKey, refreshTick]);

  const retry = (): void => {
    setRefreshTick((tick) => tick + 1);
  };

  const revoke = async (rule: ApprovalRule): Promise<void> => {
    setRevokingId(rule.id);
    setRevokeError('');
    try {
      await revokeApprovalRule(rule.id);
      setConfirmingId((current) => (current === rule.id ? null : current));
      setState((current) => ({
        ...current,
        rules: current.rules.filter((item) => item.id !== rule.id),
      }));
    } catch (error) {
      // A 404 means the rule is already gone (revoked elsewhere): drop
      // the row quietly, like a successful revoke.
      if (error instanceof ApiError && error.status === 404) {
        setConfirmingId((current) => (current === rule.id ? null : current));
        setState((current) => ({
          ...current,
          rules: current.rules.filter((item) => item.id !== rule.id),
        }));
        return;
      }
      setRevokeError(error instanceof Error ? error.message : 'Could not revoke the rule.');
    } finally {
      setRevokingId((current) => (current === rule.id ? null : current));
    }
  };

  return (
    <section
      aria-label="Always allowed"
      className="flex flex-col gap-2 border-t border-divider pt-4"
      data-scope={scopeKey}
    >
      <h3 className="text-[14px] font-medium">Always allowed</h3>

      {state.status === 'loading' && (
        <p role="status" className="text-[13px] text-muted-foreground">
          Loading…
        </p>
      )}

      {state.status === 'error' && (
        <div className="flex flex-col gap-2">
          <FieldError>{state.message}</FieldError>
          <Button type="button" size="lg" className="self-start rounded-full px-5" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {state.status === 'ready' && state.rules.length === 0 && (
        <p className="text-[13px] text-muted-foreground">Nothing is always allowed here.</p>
      )}

      {state.status === 'ready' && state.rules.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Always allowed rules">
          {state.rules.map((rule) => {
            const confirming = confirmingId === rule.id;
            const revoking = revokingId === rule.id;
            return (
              <li
                key={rule.id}
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px]">{rule.action}</p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {scopeTextFor(rule, groupInfos, topicName)}
                  </p>
                </div>
                {readOnly ? null : confirming ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-[12px] text-muted-foreground">
                      Stop always allowing {rule.action}?
                    </span>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      aria-label={`Confirm revoking ${rule.action}`}
                      disabled={revoking}
                      onClick={() => void revoke(rule)}
                    >
                      {revoking ? 'Revoking…' : 'Revoke'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={revoking}
                      onClick={() => {
                        setConfirmingId(null);
                        setRevokeError('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Revoke ${rule.action}`}
                    className="shrink-0"
                    disabled={revokingId !== null}
                    onClick={() => {
                      setConfirmingId(rule.id);
                      setRevokeError('');
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {revokeError !== '' && <FieldError>{revokeError}</FieldError>}
    </section>
  );
}
