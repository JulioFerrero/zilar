import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import {
  listAiToolDetails,
  listGroupToolDetails,
  listTopicToolDetails,
  type ToolListItem,
} from '@/lib/tools';
import { fromApi } from '@/lib/effect/api-effect';
import { type ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { Button, FieldError } from '@/components/ais/AiPageShell';
import { StateMessage } from '../ui/state-message';
import { ToolDetailPanel } from './ToolDetailPanel';

type ListStatus = 'loading' | 'ready' | 'error';

function hostsLine(hosts: readonly string[]): string {
  return hosts.length === 0 ? 'no sites' : hosts.join(', ');
}

function lastRunText(tool: ToolListItem): string {
  const at = new Date(tool.updatedAt);
  const status = tool.lastRunStatus === null ? 'never run' : `last run ${tool.lastRunStatus}`;
  return `${status} · ${at.toLocaleDateString()}`;
}

/** The API's own message, or the fallback for a failure that was not an API answer. */
function failureText(failure: ApiFailure | undefined, fallback: string): string {
  if (failure === undefined || (failure.status === 0 && failure.code === 'unknown_error')) {
    return fallback;
  }
  return failure.message;
}

/**
 * The Tools section of a topic, a group's General, or an AI (T-0107):
 * every tool with name, description, version, hosts (declared, and
 * approved when the API gives it), and last run. Selecting a row opens
 * the detail panel. Actions the API would refuse hide (member vs
 * admin/owner): `canManage` comes from the caller, and a 403/404 from
 * the server shows an inline message instead of crashing.
 */
export function ToolsSection({
  scope,
  scopeKey,
  canManage,
}: {
  /** Exactly one of the three lists, matching the server routes. */
  scope: { topicId: string } | { groupId: string } | { aiId: string };
  scopeKey: string;
  /** False hides Run/Revert/Delete (a member the API would refuse). */
  canManage: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // `scopeKey` is the stable key: a new scope loads again, a refresh reloads
  // the scope it was built for.
  const [list, reloadList] = useQuery(() => loadScopeTools(scope), [scopeKey]);

  const reload = (): void => {
    setSelectedId(null);
    reloadList();
  };

  if (selectedId !== null) {
    return (
      <ToolDetailPanel
        toolId={selectedId}
        canManage={canManage}
        onDeleted={reload}
        onClose={() => setSelectedId(null)}
      />
    );
  }

  // A reload shows Loading… again, as the list did before the hook.
  const loading = isWaiting(list) || AsyncResult.isInitial(list);
  const failure = AsyncResult.isFailure(list) && !loading ? failureOf(list) : undefined;
  const status: ListStatus = loading ? 'loading' : AsyncResult.isFailure(list) ? 'error' : 'ready';
  const tools = status === 'ready' && AsyncResult.isSuccess(list) ? list.value : [];

  return (
    <section aria-label="Tools" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Tools</h2>
      {status === 'loading' && <StateMessage kind="loading" size="inline" title="Loading…" />}
      {status === 'error' && (
        <div className="flex flex-col gap-2 px-2">
          <FieldError>{failureText(failure, 'Could not load the tools.')}</FieldError>
          <Button
            type="button"
            size="lg"
            className="self-start rounded-full px-4"
            onClick={() => reloadList()}
          >
            Retry
          </Button>
        </div>
      )}
      {status === 'ready' && tools.length === 0 && (
        <StateMessage
          kind="empty"
          size="inline"
          title="No tools here yet. An AI can write small tools that run on a schedule — ask it in the chat."
        />
      )}
      {status === 'ready' &&
        tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => setSelectedId(tool.id)}
            aria-label={`Open ${tool.name}`}
            className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[14px] font-medium">{tool.name}</span>
                <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                  v{tool.currentVersion}
                </span>
              </div>
              <p className="truncate text-[12px] text-muted-foreground">{tool.description}</p>
              <p className="truncate text-[12px] text-muted-foreground">
                {hostsLine(tool.hosts)}
                {tool.approvedHosts !== undefined && tool.hosts.length > 0
                  ? ` · approved: ${hostsLine(tool.approvedHosts)}`
                  : ''}{' '}
                · {lastRunText(tool)}
              </p>
            </div>
          </button>
        ))}
    </section>
  );
}

/**
 * A failure that parses as "no such scope" reads as an empty list (older
 * server, or a strict fetch mock answering 404/[] for the new endpoints),
 * so the section never adds noise to the panel. Any other failure stays
 * the inline error with Retry.
 */
function loadScopeTools(
  scope:
    | {
        topicId: string;
      }
    | { groupId: string }
    | { aiId: string },
): Effect.Effect<ToolListItem[], ApiFailure> {
  const call = (): Promise<ToolListItem[]> => {
    if ('topicId' in scope) {
      return listTopicToolDetails(scope.topicId);
    }
    if ('groupId' in scope) {
      return listGroupToolDetails(scope.groupId);
    }
    return listAiToolDetails(scope.aiId);
  };
  return fromApi(call).pipe(
    Effect.catchIf(
      (failure) => failure.status === 404 || failure.code === 'invalid_response',
      () => Effect.succeed([]),
    ),
  );
}
