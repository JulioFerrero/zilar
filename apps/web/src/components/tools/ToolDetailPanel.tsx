import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import {
  getToolVersion,
  listToolRuns,
  revertTool,
  type ToolRun,
  type ToolRunResult,
} from '@/lib/tools';
import { Button, FieldError } from '@/components/ais/AiPageShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StateMessage } from '@/components/ui/state-message';
import { fromApi } from '@/lib/effect/api-effect';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { DeleteToolButton } from './DeleteToolButton';
import { ToolRunSection } from './ToolRunSection';
import { ToolSourceSection } from './ToolSourceSection';
import {
  failureText,
  hostsLine,
  inputErrorText,
  loadDetail,
  runErrorText,
  runToolWithInput,
  settledFailure,
} from './toolDetailOps';

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
  const [loaded, reloadDetail] = useQuery(() => loadDetail(toolId), [toolId]);

  // The source the user picked from the history; undefined shows the
  // current version. Cleared on every reload, as the panel did before.
  const [picked, setPicked] = useState<{ version: number; source: string } | null>(null);
  // The recent runs after a run; undefined shows the loaded list.
  const [freshRuns, setFreshRuns] = useState<ToolRun[] | null>(null);
  const [confirmingRevert, setConfirmingRevert] = useState<number | null>(null);

  // Run now: optional JSON input, validated before the POST (the server also
  // enforces 16 KiB). The result stays in local state, as before.
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
      // The run itself succeeded: a failed history refresh must not turn it
      // into an error, the old list simply stays until the next refresh.
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
  // A failure shows only once its call has ended; a new call clears it.
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
