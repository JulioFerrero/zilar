import { CodeBlock, TruncatedText } from './CodeBlock';
import {
  failureText,
  hostsLine,
  inputErrorText,
  loadDetail,
  runErrorText,
  runToolWithInput,
  settledFailure,
  runStatusText,
} from './toolDetailOps';
import { Button, FieldError } from '@/components/ais/AiPageShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StateMessage } from '@/components/ui/state-message';
import { TextArea } from '@/components/ui/text-input';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import {
  getToolVersion,
  listToolRuns,
  revertTool,
  type ToolRun,
  type ToolRunResult,
  deleteTool,
  type ToolVersion,
} from '@/lib/tools';
import { truncateOutput } from '@zilar/chat-core';
import { fromApi, type ApiFailure } from '@zilar/client-core';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';

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
  const [state, remove] = useAction<void, void, ApiFailure>(() =>
    fromApi(() => deleteTool(toolId)).pipe(
      Effect.tap(() => Effect.sync(() => onDeleted(toolId))),
      Effect.ensuring(Effect.sync(() => setConfirming(false))),
    ),
  );
  if (!canManage) {
    return null;
  }
  const busy = isWaiting(state);
  const failure = busy ? undefined : failureOf(state);
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
      {failure !== undefined && (
        <FieldError>{failureText(failure, 'Could not delete the tool.')}</FieldError>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Delete ${toolName}?`}
          body="This deletes the tool and its routines. This cannot be undone."
          confirmLabel={busy ? 'Deleting…' : 'Delete'}
          onConfirm={() => remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function ToolSourceSection({
  toolName,
  currentVersion,
  versions,
  shownVersion,
  shownSource,
  shownHosts,
  sourceError,
  revertFailure,
  canManage,
  busy,
  onShowVersion,
  onRequestRevert,
}: {
  toolName: string;
  currentVersion: number;
  versions: ToolVersion[];
  shownVersion: number;
  shownSource: string;
  shownHosts: readonly string[];
  sourceError: ApiFailure | undefined;
  revertFailure: ApiFailure | undefined;
  canManage: boolean;
  busy: boolean;
  onShowVersion: (version: number) => void;
  onRequestRevert: (version: number) => void;
}) {
  return (
    <>
      <section aria-label="Source" className="flex flex-col gap-2">
        <h4 className="px-2 text-[13px] font-semibold text-muted-foreground">
          Source (v{shownVersion}, read-only)
        </h4>
        {sourceError !== undefined && (
          <FieldError>{failureText(sourceError, 'Could not load that version.')}</FieldError>
        )}
        <CodeBlock code={shownSource} label={`Source of ${toolName} v${shownVersion}`} />
        {shownVersion !== currentVersion && (
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
              onClick={() => onShowVersion(version.version)}
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
            {canManage && version.version !== currentVersion && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Revert to v${version.version}`}
                className="shrink-0"
                disabled={busy}
                onClick={() => onRequestRevert(version.version)}
              >
                Revert to this version
              </Button>
            )}
          </div>
        ))}
        {revertFailure !== undefined && (
          <FieldError>{failureText(revertFailure, 'Could not revert the tool.')}</FieldError>
        )}
      </section>
    </>
  );
}

function ToolRunSection({
  canManage,
  runInput,
  onRunInputChange,
  inputError,
  running,
  runError,
  runResult,
  runs,
  onStartRun,
}: {
  canManage: boolean;
  runInput: string;
  onRunInputChange: (value: string) => void;
  inputError: string | undefined;
  running: boolean;
  runError: string | undefined;
  runResult: ToolRunResult | null;
  runs: ToolRun[];
  onStartRun: () => void;
}) {
  return (
    <>
      {canManage && (
        <section aria-label="Run now" className="flex flex-col gap-2">
          <h4 className="px-2 text-[13px] font-semibold text-muted-foreground">Run now</h4>
          <label className="flex flex-col gap-1 px-2">
            <span className="text-[13px] text-muted-foreground">
              Optional JSON input (max 4 KB)
            </span>
            <TextArea
              aria-label="Run input (JSON)"
              rows={3}
              value={runInput}
              onChange={(event) => onRunInputChange(event.target.value)}
              placeholder='e.g. {"city": "Madrid"}'
              className="min-h-0 font-mono text-[13px]"
            />
          </label>
          {inputError !== undefined && <FieldError>{inputError}</FieldError>}
          <div className="px-2">
            <Button
              type="button"
              size="lg"
              className="rounded-full px-4"
              disabled={running}
              onClick={onStartRun}
            >
              {running ? 'Running…' : 'Run now'}
            </Button>
          </div>
          {runError !== undefined && <FieldError>{runError}</FieldError>}
          {runResult !== null && <RunResultBlock result={runResult} />}
        </section>
      )}

      <section aria-label="Recent runs" className="flex flex-col gap-1">
        <h4 className="px-2 text-[13px] font-semibold text-muted-foreground">Recent runs</h4>
        {runs.length === 0 && (
          <p className="px-2 text-[13px] text-muted-foreground">No runs yet.</p>
        )}
        {runs.map((run) => (
          <div key={run.id} className="flex flex-col gap-1 rounded-xl px-2 py-1.5">
            <p className="text-[13px]">{runStatusText(run)}</p>
            {run.status === 'error' && (
              <p className="text-[13px] text-muted-foreground">
                Failed: {run.errorKind ?? 'failed'}
              </p>
            )}
            {run.status === 'ok' && run.outputText !== null && <RunOutput text={run.outputText} />}
          </div>
        ))}
      </section>
    </>
  );
}

function RunResultBlock({ result }: { result: ToolRunResult }) {
  if (!result.ok) {
    const text =
      result.logs === '' ? result.error.message : `${result.error.message}\n${result.logs}`;
    return (
      <div className="flex flex-col gap-1 px-2">
        <p className="text-[13px] text-danger">Failed: {result.error.kind}</p>
        <RunOutput text={text} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 px-2">
      <p className="text-[13px] text-muted-foreground">
        Ok in {result.durationMs} ms · {result.fetchCount}{' '}
        {result.fetchCount === 1 ? 'fetch' : 'fetches'}
      </p>
      <RunOutput text={result.output.text} />
    </div>
  );
}

function RunOutput({ text }: { text: string }) {
  const cut = truncateOutput(text);
  return <TruncatedText text={text} preview={cut.preview} truncated={cut.truncated} />;
}

export function ToolDetailPanel({
  toolId,
  canManage,
  onDeleted,
  onClose,
}: {
  toolId: string;
  canManage: boolean;
  onDeleted: (toolId: string) => void;
  onClose: () => void;
}) {
  const [loaded, reloadDetail] = useQuery(() => loadDetail(toolId), [toolId]);

  const [picked, setPicked] = useState<{ version: number; source: string } | null>(null);
  const [freshRuns, setFreshRuns] = useState<ToolRun[] | null>(null);
  const [confirmingRevert, setConfirmingRevert] = useState<number | null>(null);

  // Run now takes optional JSON input, validated before the POST (the server
  // also enforces 16 KiB).
  const [runInput, setRunInput] = useState('');
  const [runResult, setRunResult] = useState<ToolRunResult | null>(null);

  const [sourceState, showSource, showControls] = useAction(
    (version: number) =>
      fromApi(() => getToolVersion(toolId, version)).pipe(
        Effect.tap((detail) =>
          Effect.sync(() => setPicked({ version: detail.version, source: detail.source })),
        ),
      ),
    { mode: 'replace' },
  );

  const reload = (): void => {
    setPicked(null);
    setFreshRuns(null);
    reloadDetail();
  };

  const [revertState, revertVersion] = useAction((version: number) =>
    fromApi(() => revertTool(toolId, version)).pipe(
      Effect.tap(() => Effect.sync(reload)),
      Effect.ensuring(Effect.sync(() => setConfirmingRevert(null))),
    ),
  );

  const [runState, runNow] = useAction((text: string) =>
    runToolWithInput(toolId, text).pipe(
      Effect.tap((result) => Effect.sync(() => setRunResult(result))),
      // The run itself succeeded: a failed history refresh must not turn it into an
      // error, so the old list stays until the next refresh.
      Effect.tap(() =>
        fromApi(() => listToolRuns(toolId)).pipe(
          Effect.tap((fresh) => Effect.sync(() => setFreshRuns(fresh))),
          Effect.ignore,
        ),
      ),
    ),
  );

  if (AsyncResult.isFailure(loaded)) {
    const loadFailure = failureOf(loaded);
    return (
      <div className="flex flex-col gap-2 px-2">
        <FieldError>{failureText(loadFailure, 'Could not load the tool.')}</FieldError>
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

  if (!AsyncResult.isSuccess(loaded)) {
    return <StateMessage kind="loading" size="inline" title="Loading…" />;
  }

  const { detail: tool, versions, runs: loadedRuns } = loaded.value;
  const shownVersion = picked?.version ?? tool.currentVersion;
  const shownSource = picked?.source ?? tool.source;
  const runs = freshRuns ?? loadedRuns;
  const sourceError = settledFailure(sourceState);
  const revertFailure = settledFailure(revertState);
  const runFailure = settledFailure(runState);
  const inputError = inputErrorText(runFailure);
  const runError = runErrorText(runFailure);
  const busy = isWaiting(revertState);
  const running = isWaiting(runState);

  const shownHosts =
    versions.find((version) => version.version === shownVersion)?.hosts ?? tool.hosts;
  const approvedHosts = tool.approvedHosts ?? [];
  const unapproved = tool.hosts.filter((host) => !approvedHosts.includes(host));

  const showVersion = (version: number): void => {
    if (version === tool.currentVersion) {
      setPicked(null);
      showControls.reset();
      return;
    }
    showSource(version);
  };

  const startRun = (): void => {
    setRunResult(null);
    runNow(runInput);
  };

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

      <ToolSourceSection
        toolName={tool.name}
        currentVersion={tool.currentVersion}
        versions={versions}
        shownVersion={shownVersion}
        shownSource={shownSource}
        shownHosts={shownHosts}
        sourceError={sourceError}
        revertFailure={revertFailure}
        canManage={canManage}
        busy={busy}
        onShowVersion={showVersion}
        onRequestRevert={setConfirmingRevert}
      />

      <ToolRunSection
        canManage={canManage}
        runInput={runInput}
        onRunInputChange={setRunInput}
        inputError={inputError}
        running={running}
        runError={runError}
        runResult={runResult}
        runs={runs}
        onStartRun={startRun}
      />

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
          onConfirm={() => revertVersion(confirmingRevert)}
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
