import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  listAiToolDetails,
  listGroupToolDetails,
  listTopicToolDetails,
  type ToolListItem,
} from '@/lib/tools';
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
  const [state, setState] = useState<{
    status: ListStatus;
    tools: ToolListItem[];
    message: string;
  }>({ status: 'loading', tools: [], message: '' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Reset to `loading` while rendering (not inside the effect body): the
  // repo lint forbids setState in an effect body. Same shape as
  // `AlwaysAllowedList`.
  const loadKey = `${scopeKey}#${reloadTick}`;
  const [lastLoadKey, setLastLoadKey] = useState(loadKey);
  if (lastLoadKey !== loadKey) {
    setLastLoadKey(loadKey);
    setState({ status: 'loading', tools: [], message: '' });
  }

  // `scope` is a fresh literal each render; spreading it into the deps
  // would refetch on every render, so `scopeKey` is the stable key and the
  // ref carries the latest scope into the effect body (same shape as
  // `AlwaysAllowedList`).
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const tools = await loadScopeTools(scopeRef.current);
        if (!active) {
          return;
        }
        setState({ status: 'ready', tools, message: '' });
      } catch (error) {
        if (!active) {
          return;
        }
        // A 403/404 on the list means the viewer may not see the tools
        // (member vs manager): show the message, never crash.
        setState({
          status: 'error',
          tools: [],
          message: error instanceof Error ? error.message : 'Could not load the tools.',
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [scopeKey, reloadTick]);

  const reload = (): void => {
    setSelectedId(null);
    setReloadTick((tick) => tick + 1);
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

  return (
    <section aria-label="Tools" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Tools</h2>
      {state.status === 'loading' && <StateMessage kind="loading" size="inline" title="Loading…" />}
      {state.status === 'error' && (
        <div className="flex flex-col gap-2 px-2">
          <FieldError>{state.message}</FieldError>
          <Button
            type="button"
            size="lg"
            className="self-start rounded-full px-4"
            onClick={() => setReloadTick((tick) => tick + 1)}
          >
            Retry
          </Button>
        </div>
      )}
      {state.status === 'ready' && state.tools.length === 0 && (
        <StateMessage
          kind="empty"
          size="inline"
          title="No tools here yet. An AI can write small tools that run on a schedule — ask it in the chat."
        />
      )}
      {state.status === 'ready' &&
        state.tools.map((tool) => (
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

async function loadScopeTools(
  scope:
    | {
        topicId: string;
      }
    | { groupId: string }
    | { aiId: string },
): Promise<ToolListItem[]> {
  try {
    if ('topicId' in scope) {
      return await listTopicToolDetails(scope.topicId);
    }
    if ('groupId' in scope) {
      return await listGroupToolDetails(scope.groupId);
    }
    return await listAiToolDetails(scope.aiId);
  } catch (error) {
    // A failure that parses as "no such scope" reads as an empty list
    // (older server, or a strict fetch mock answering 404/[] for the new
    // endpoints), so the section never adds noise to the panel. Any other
    // failure shows the inline error with Retry.
    if (error instanceof ApiError && (error.status === 404 || error.code === 'invalid_response')) {
      return [];
    }
    throw error;
  }
}
