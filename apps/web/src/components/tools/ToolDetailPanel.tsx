import { Data, Effect, Result, Schema } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
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
import { StateMessage } from '@/components/ui/state-message';
import { TextArea } from '@/components/ui/text-input';
import { fromApi } from '@/lib/effect/api-effect';
import { type ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { CodeBlock, TruncatedText } from './CodeBlock';

const MAX_RUN_INPUT_BYTES = 4 * 1024;

/** The run input is any JSON value, decoded from its text by Effect Schema. */
const RUN_INPUT_JSON = Schema.fromJsonString(Schema.Unknown);

class InputNotJson extends Data.TaggedError('InputNotJson') {}
class InputTooLarge extends Data.TaggedError('InputTooLarge') {}

type RunFailure = InputNotJson | InputTooLarge | ApiFailure;

interface LoadedTool {
  readonly detail: ToolDetail;
  readonly versions: ToolVersion[];
  readonly runs: ToolRun[];
}

function hostsLine(hosts: readonly string[]): string {
  return hosts.length === 0 ? 'no sites' : hosts.join(', ');
}

function runStatusText(run: ToolRun): string {
  const at = new Date(run.createdAt);
  const label = run.status === 'ok' ? 'ok' : `error (${run.errorKind ?? 'failed'})`;
  return `${label} · v${run.version} · ${run.trigger} · ${run.durationMs} ms · ${at.toLocaleString()}`;
}

/** The API's own message, or the fallback for a failure that was not an API answer. */
function failureText(failure: ApiFailure | undefined, fallback: string): string {
  if (failure === undefined || (failure.status === 0 && failure.code === 'unknown_error')) {
    return fallback;
  }
  return failure.message;
}

/** The typed failure of a call that has ended; a call still running shows none. */
function settledFailure<A, E>(state: AsyncResult.AsyncResult<A, E>): E | undefined {
  return isWaiting(state) ? undefined : failureOf(state);
}

function loadDetail(toolId: string): Effect.Effect<LoadedTool, ApiFailure> {
  return Effect.all(
    {
      detail: fromApi(() => getToolDetail(toolId)),
      versions: fromApi(() => listToolVersions(toolId)),
      runs: fromApi(() => listToolRuns(toolId)),
    },
    { concurrency: 'unbounded' },
  );
}

/** Checks the optional JSON input (max 4 KB), then runs the tool once. */
function runToolWithInput(toolId: string, text: string): Effect.Effect<ToolRunResult, RunFailure> {
  const trimmed = text.trim();
  const input: Effect.Effect<unknown, InputNotJson | InputTooLarge> =
    trimmed === '' ? Effect.succeed(undefined) : parseRunInput(trimmed);
  return input.pipe(
    Effect.andThen((value) =>
      fromApi(() => (value === undefined ? runToolNow(toolId) : runToolNow(toolId, value))),
    ),
  );
}

function parseRunInput(trimmed: string): Effect.Effect<unknown, InputNotJson | InputTooLarge> {
  const decoded = Schema.decodeUnknownResult(RUN_INPUT_JSON)(trimmed);
  if (!Result.isSuccess(decoded)) {
    return Effect.fail(new InputNotJson());
  }
  if (new Blob([trimmed]).size > MAX_RUN_INPUT_BYTES) {
    return Effect.fail(new InputTooLarge());
  }
  return Effect.succeed(decoded.success);
}

/** The text under the run input field, for an input the run never sent. */
function inputErrorText(failure: RunFailure | undefined): string | undefined {
  if (failure?._tag === 'InputNotJson') {
    return 'Input must be valid JSON.';
  }
  if (failure?._tag === 'InputTooLarge') {
    return 'Input must be at most 4 KB.';
  }
  return undefined;
}

/** The text under the Run button, for a run the API refused or failed. */
function runErrorText(failure: RunFailure | undefined): string | undefined {
  if (
    failure === undefined ||
    failure._tag === 'InputNotJson' ||
    failure._tag === 'InputTooLarge'
  ) {
    return undefined;
  }
  if (failure.status === 403 || failure.status === 404) {
    return 'You may not run this tool.';
  }
  return failureText(failure, 'Could not run the tool.');
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

      <section aria-label="Source" className="flex flex-col gap-2">
        <h4 className="px-2 text-[13px] font-semibold text-muted-foreground">
          Source (v{shownVersion}, read-only)
        </h4>
        {sourceError !== undefined && (
          <FieldError>{failureText(sourceError, 'Could not load that version.')}</FieldError>
        )}
        <CodeBlock code={shownSource} label={`Source of ${tool.name} v${shownVersion}`} />
        {shownVersion !== tool.currentVersion && (
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
              onClick={() => showVersion(version.version)}
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
        {revertFailure !== undefined && (
          <FieldError>{failureText(revertFailure, 'Could not revert the tool.')}</FieldError>
        )}
      </section>

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
              onChange={(event) => setRunInput(event.target.value)}
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
              onClick={startRun}
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
