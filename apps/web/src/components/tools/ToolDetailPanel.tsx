import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  deleteTool,
  getToolDetail,
  getToolVersion,
  listToolRuns,
  listToolVersions,
  revertTool,
  runToolNow,
  type ToolDetail,
  type ToolRun,
  type ToolRunResult,
  type ToolVersion,
} from '@/lib/tools';
import { truncateOutput } from '@/lib/routines';
import { Button, FieldError } from '@/components/ais/AiPageShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CodeBlock, TruncatedText } from './CodeBlock';

type DetailStatus = 'loading' | 'ready' | 'error';

const MAX_RUN_INPUT_BYTES = 4 * 1024;

function hostsLine(hosts: readonly string[]): string {
  return hosts.length === 0 ? 'no sites' : hosts.join(', ');
}

function runStatusText(run: ToolRun): string {
  const at = new Date(run.createdAt);
  const label = run.status === 'ok' ? 'ok' : `error (${run.errorKind ?? 'failed'})`;
  return `${label} · v${run.version} · ${run.trigger} · ${run.durationMs} ms · ${at.toLocaleString()}`;
}

/**
 * One tool with its source, versions, runs and actions (T-0107): read-only
 * source with line numbers, version history with revert (confirm step),
 * Run now with an optional JSON input (validated, max 4 KB), recent runs,
 * and Delete (confirm step, handled by the parent). Everything renders as
 * text, never HTML. Actions the API would refuse hide after a 403/404 on
 * load; a 403/404 from a write shows an inline message, no crash.
 */
export function ToolDetailPanel({
  toolId,
  canManage,
  onDeleted,
  onClose,
}: {
  toolId: string;
  /** False hides Run/Revert/Delete (a member the API would refuse). */
  canManage: boolean;
  onDeleted: (toolId: string) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<DetailStatus>('loading');
  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [versions, setVersions] = useState<ToolVersion[]>([]);
  const [runs, setRuns] = useState<ToolRun[]>([]);
  const [message, setMessage] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  // Version source preview: the current version by default, an older one
  // when picked from the history.
  const [shownVersion, setShownVersion] = useState<number | null>(null);
  const [shownSource, setShownSource] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState('');

  const [confirmingRevert, setConfirmingRevert] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  // Run now: optional JSON input, validated client-side (max 4 KB) before
  // the POST (the server also enforces 16 KiB).
  const [runInput, setRunInput] = useState('');
  const [runInputError, setRunInputError] = useState('');
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<ToolRunResult | null>(null);
  const [runError, setRunError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [detail, history, recent] = await Promise.all([
          getToolDetail(toolId),
          listToolVersions(toolId),
          listToolRuns(toolId),
        ]);
        if (!active) {
          return;
        }
        setTool(detail);
        setVersions(history);
        setRuns(recent);
        setShownVersion(detail.currentVersion);
        setShownSource(detail.source);
        setStatus('ready');
      } catch (error) {
        if (!active) {
          return;
        }
        setMessage(error instanceof Error ? error.message : 'Could not load the tool.');
        setStatus('error');
      }
    })();
    return () => {
      active = false;
    };
  }, [toolId, reloadTick]);

  const showVersion = async (version: number): Promise<void> => {
    if (tool !== null && version === tool.currentVersion) {
      setShownVersion(version);
      setShownSource(tool.source);
      setSourceError('');
      return;
    }
    setSourceError('');
    try {
      const detail = await getToolVersion(toolId, version);
      setShownVersion(detail.version);
      setShownSource(detail.source);
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : 'Could not load that version.');
    }
  };

  const reload = (): void => {
    setReloadTick((tick) => tick + 1);
  };

  const revert = async (version: number): Promise<void> => {
    setBusy(true);
    setActionError('');
    try {
      await revertTool(toolId, version);
      setConfirmingRevert(null);
      reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not revert the tool.');
      setConfirmingRevert(null);
    } finally {
      setBusy(false);
    }
  };

  const run = async (): Promise<void> => {
    setRunInputError('');
    setRunError('');
    setRunResult(null);
    let input: unknown = undefined;
    const trimmed = runInput.trim();
    if (trimmed !== '') {
      try {
        input = JSON.parse(trimmed) as unknown;
      } catch {
        setRunInputError('Input must be valid JSON.');
        return;
      }
      const bytes = new Blob([trimmed]).size;
      if (bytes > MAX_RUN_INPUT_BYTES) {
        setRunInputError('Input must be at most 4 KB.');
        return;
      }
    }
    setRunning(true);
    try {
      const result =
        input === undefined ? await runToolNow(toolId) : await runToolNow(toolId, input);
      setRunResult(result);
      setRuns(await listToolRuns(toolId));
    } catch (error) {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        setRunError('You may not run this tool.');
      } else {
        setRunError(error instanceof Error ? error.message : 'Could not run the tool.');
      }
    } finally {
      setRunning(false);
    }
  };

  if (status === 'loading') {
    return <p className="px-2 text-[13px] text-muted-foreground">Loading…</p>;
  }

  if (status === 'error' || tool === null) {
    return (
      <div className="flex flex-col gap-2 px-2">
        <FieldError>{message === '' ? 'Could not load the tool.' : message}</FieldError>
        <div className="flex gap-2">
          <Button type="button" size="lg" className="rounded-full px-4" onClick={reload}>
            Retry
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="rounded-full px-4"
            onClick={onClose}
          >
            Back
          </Button>
        </div>
      </div>
    );
  }

  const shownHosts =
    versions.find((version) => version.version === shownVersion)?.hosts ?? tool.hosts;
  const approvedHosts = tool.approvedHosts ?? [];
  const unapproved = tool.hosts.filter((host) => !approvedHosts.includes(host));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 px-2">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{tool.name}</h3>
          <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
            v{tool.currentVersion}
          </span>
        </div>
        <p className="text-[13px] text-muted-foreground">{tool.description}</p>
        <p className="text-[13px] text-muted-foreground">
          Contacts: {hostsLine(tool.hosts)}
          {tool.hosts.length > 0 && <span> · Approved: {hostsLine(approvedHosts)}</span>}
        </p>
        {unapproved.length > 0 && (
          <p className="text-[13px] text-muted-foreground">
            Waiting for approval: {hostsLine(unapproved)}. Ask the AI to approve these hosts.
          </p>
        )}
        {tool.lastRunStatus !== null && (
          <p className="text-[13px] text-muted-foreground">
            Last run: {tool.lastRunStatus === 'ok' ? 'ok' : 'error'}
          </p>
        )}
      </div>

      <section aria-label="Source" className="flex flex-col gap-2">
        <h4 className="px-2 text-[13px] font-semibold text-muted-foreground">
          Source (v{shownVersion ?? tool.currentVersion}, read-only)
        </h4>
        {sourceError !== '' && <FieldError>{sourceError}</FieldError>}
        {shownSource !== null && (
          <CodeBlock
            code={shownSource}
            label={`Source of ${tool.name} v${shownVersion ?? tool.currentVersion}`}
          />
        )}
        {shownVersion !== null && shownVersion !== tool.currentVersion && (
          <p className="px-2 text-[13px] text-muted-foreground">
            Showing v{shownVersion} ({hostsLine(shownHosts)}); revert to make it current.
          </p>
        )}
      </section>

      <section aria-label="Version history" className="flex flex-col gap-1">
        <h4 className="px-2 text-[13px] font-semibold text-muted-foreground">Version history</h4>
        {versions.length === 0 && (
          <p className="px-2 text-[13px] text-muted-foreground">No versions yet.</p>
        )}
        {versions.map((version) => (
          <div
            key={version.id}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
          >
            <button
              type="button"
              onClick={() => void showVersion(version.version)}
              aria-label={`Show source of v${version.version}`}
              className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <p className="truncate text-[14px]">
                v{version.version} · {version.message}
              </p>
              <p className="truncate text-[12px] text-muted-foreground">
                {hostsLine(version.hosts)} · by {version.createdBy} ·{' '}
                {new Date(version.createdAt).toLocaleString()}
              </p>
            </button>
            {canManage && version.version !== tool.currentVersion && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Revert to v${version.version}`}
                className="shrink-0"
                disabled={busy}
                onClick={() => setConfirmingRevert(version.version)}
              >
                Revert to this version
              </Button>
            )}
          </div>
        ))}
        {actionError !== '' && <FieldError>{actionError}</FieldError>}
      </section>

      {canManage && (
        <section aria-label="Run now" className="flex flex-col gap-2">
          <h4 className="px-2 text-[13px] font-semibold text-muted-foreground">Run now</h4>
          <label className="flex flex-col gap-1 px-2">
            <span className="text-[13px] text-muted-foreground">
              Optional JSON input (max 4 KB)
            </span>
            <textarea
              aria-label="Run input (JSON)"
              rows={3}
              value={runInput}
              onChange={(event) => setRunInput(event.target.value)}
              placeholder='e.g. {"city": "Madrid"}'
              className="well-surface min-w-0 rounded-[10px] px-3 py-2 font-mono text-[13px] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </label>
          {runInputError !== '' && <FieldError>{runInputError}</FieldError>}
          <div className="px-2">
            <Button
              type="button"
              size="lg"
              className="rounded-full px-4"
              disabled={running}
              onClick={() => void run()}
            >
              {running ? 'Running…' : 'Run now'}
            </Button>
          </div>
          {runError !== '' && <FieldError>{runError}</FieldError>}
          {runResult !== null && <RunResultBlock result={runResult} />}
        </section>
      )}

      <section aria-label="Recent runs" className="flex flex-col gap-1">
        <h4 className="px-2 text-[13px] font-semibold text-muted-foreground">Recent runs</h4>
        {runs.length === 0 && (
          <p className="px-2 text-[13px] text-muted-foreground">No runs yet.</p>
        )}
        {runs.map((run) => {
          const cut =
            run.status === 'ok' && run.outputText !== null ? truncateOutput(run.outputText) : null;
          return (
            <div key={run.id} className="flex flex-col gap-1 rounded-xl px-2 py-1.5">
              <p className="text-[13px]">{runStatusText(run)}</p>
              {run.status === 'error' && (
                <p className="text-[13px] text-muted-foreground">
                  Failed: {run.errorKind ?? 'failed'}
                </p>
              )}
              {cut !== null && (
                <TruncatedText
                  text={run.outputText ?? ''}
                  preview={cut.preview}
                  truncated={cut.truncated}
                />
              )}
            </div>
          );
        })}
      </section>

      <div className="px-2">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="rounded-full px-4"
          onClick={onClose}
        >
          Back to tools
        </Button>
      </div>

      {confirmingRevert !== null && (
        <ConfirmDialog
          title={`Revert ${tool.name} to v${confirmingRevert}?`}
          body="This creates a new version copying that version's code. The history keeps every version."
          confirmLabel={busy ? 'Reverting…' : 'Revert'}
          onConfirm={() => void revert(confirmingRevert)}
          onCancel={() => setConfirmingRevert(null)}
        />
      )}
      <DeleteToolButton
        toolId={tool.id}
        toolName={tool.name}
        canManage={canManage}
        onDeleted={onDeleted}
      />
    </div>
  );
}

function RunResultBlock({ result }: { result: ToolRunResult }) {
  if (!result.ok) {
    return (
      <div className="flex flex-col gap-1 px-2">
        <p className="text-[13px] text-danger">Failed: {result.error.kind}</p>
        <TruncatedText
          text={
            result.logs === '' ? result.error.message : `${result.error.message}\n${result.logs}`
          }
          {...truncateOutput(
            result.logs === '' ? result.error.message : `${result.error.message}\n${result.logs}`,
          )}
        />
      </div>
    );
  }
  const cut = truncateOutput(result.output.text);
  return (
    <div className="flex flex-col gap-1 px-2">
      <p className="text-[13px] text-muted-foreground">
        Ok in {result.durationMs} ms · {result.fetchCount}{' '}
        {result.fetchCount === 1 ? 'fetch' : 'fetches'}
      </p>
      <TruncatedText text={result.output.text} preview={cut.preview} truncated={cut.truncated} />
    </div>
  );
}

function DeleteToolButton({
  toolId,
  toolName,
  canManage,
  onDeleted,
}: {
  toolId: string;
  toolName: string;
  canManage: boolean;
  onDeleted: (toolId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!canManage) {
    return null;
  }
  const remove = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await deleteTool(toolId);
      setConfirming(false);
      onDeleted(toolId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the tool.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 px-2">
      <div>
        <Button
          type="button"
          variant="destructive"
          size="lg"
          className="rounded-full px-4"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          Delete tool
        </Button>
      </div>
      {error !== '' && <FieldError>{error}</FieldError>}
      {confirming && (
        <ConfirmDialog
          title={`Delete ${toolName}?`}
          body="This deletes the tool and pauses its routines. This cannot be undone."
          confirmLabel={busy ? 'Deleting…' : 'Delete'}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
