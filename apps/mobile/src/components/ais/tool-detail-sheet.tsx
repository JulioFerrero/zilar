import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';

import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { asColorScheme } from '@/lib/color-scheme';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { fromApi } from '@/lib/effect/api-effect';
import { type ActionState, failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { hostsLine, truncateOutput } from '@/lib/routines-format';
import type {
  ToolActionsApi,
  ToolDetail,
  ToolDetailsApi,
  ToolRun,
  ToolRunResult,
  ToolVersion,
} from '@/lib/tools-api';

import { numberedLines, runStatusText, waitingHosts } from './tool-detail-format';
import {
  DELETE_FAILED_MESSAGE,
  REVERT_FAILED_MESSAGE,
  changeErrorMessage,
  fetchCountText,
  parseRunInput,
  runErrorMessage,
} from './tool-actions';

/** Fixed user-facing line when the tool fails to load. */
export const TOOL_DETAIL_LOAD_FAILED_MESSAGE = 'Could not load the tool.';

/** Fixed user-facing line when one version's source fails to load. */
export const TOOL_VERSION_LOAD_FAILED_MESSAGE = 'Could not load that version.';

/**
 * The vertical sheet ScrollView keeps Run taps while the run-input keyboard
 * is open (T-0230): a tap on Run runs at once instead of only dismissing
 * the keyboard. Pure so tests can cover it without mounting the sheet.
 */
export const SHEET_SCROLL_TAPS_PERSIST = 'handled' as const;

export type ToolDetailBodyState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      tool: ToolDetail;
      versions: ToolVersion[];
      runs: ToolRun[];
      shownVersion: number | null;
      shownSource: string | null;
      sourceError: string;
      versionBusy: boolean;
      confirmingRevert: number | null;
      actionBusy: boolean;
      actionError: string;
      runInput: string;
      runInputError: string;
      runError: string;
      runBusy: boolean;
      runResult: ToolRunResult | null;
      expandedResult: boolean;
      confirmingDelete: boolean;
      deleteBusy: boolean;
      deleteError: string;
    };

export type ToolDetailBodyActions = {
  onRetry: () => void;
  onClose: () => void;
  onShowVersion: (version: number) => void;
  onToggleOutput: (runId: string) => void;
  expandedOutputs: Set<string>;
  onAskRevert: (version: number) => void;
  onCancelRevert: () => void;
  onConfirmRevert: (version: number) => void;
  onRunInput: (text: string) => void;
  onRun: () => void;
  onToggleResult: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
};

function RunRow({
  run,
  expanded,
  onToggleOutput,
}: {
  run: ToolRun;
  expanded: boolean;
  onToggleOutput: () => void;
}) {
  const cut =
    run.status === 'ok' && run.outputText !== null ? truncateOutput(run.outputText) : null;
  return (
    <View className="gap-1 px-2 py-1.5">
      <Text className="text-[13px] text-foreground">{runStatusText(run)}</Text>
      {run.status === 'error' ? (
        <Text className="text-[13px] text-muted-foreground">
          Failed: {run.errorKind ?? 'failed'}
        </Text>
      ) : null}
      {cut !== null ? (
        <View className="gap-1">
          <Text className="font-mono text-[12px] text-muted-foreground">
            {expanded ? (run.outputText ?? '') : cut.preview}
          </Text>
          {cut.truncated ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 self-start px-0"
              accessibilityLabel={expanded ? 'Show less' : 'Show all'}
              onPress={onToggleOutput}
            >
              <Text className="text-[13px] text-foreground">
                {expanded ? 'Show less' : 'Show all'}
              </Text>
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A failed run (`ok: false`) block plus the ok-run block, like web's
 * `RunResultBlock`: the error kind/message and logs are the tool's own
 * output, not the server envelope, so they may show.
 */
function RunResultBlock({
  result,
  expanded,
  onToggle,
}: {
  result: ToolRunResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!result.ok) {
    const text =
      result.logs === '' ? result.error.message : `${result.error.message}\n${result.logs}`;
    const cut = truncateOutput(text);
    return (
      <View className="gap-1 px-2">
        <Text className="text-[13px] text-danger">Failed: {result.error.kind}</Text>
        <Text className="font-mono text-[12px] text-muted-foreground">
          {expanded ? text : cut.preview}
        </Text>
        {cut.truncated ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 self-start px-0"
            accessibilityLabel={expanded ? 'Show less' : 'Show all'}
            onPress={onToggle}
          >
            <Text className="text-[13px] text-foreground">
              {expanded ? 'Show less' : 'Show all'}
            </Text>
          </Button>
        ) : null}
      </View>
    );
  }
  const cut = truncateOutput(result.output.text);
  return (
    <View className="gap-1 px-2">
      <Text className="text-[13px] text-muted-foreground">
        Ok in {result.durationMs} ms · {fetchCountText(result.fetchCount)}
      </Text>
      <Text className="font-mono text-[12px] text-muted-foreground">
        {expanded ? result.output.text : cut.preview}
      </Text>
      {cut.truncated ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 self-start px-0"
          accessibilityLabel={expanded ? 'Show less' : 'Show all'}
          onPress={onToggle}
        >
          <Text className="text-[13px] text-foreground">{expanded ? 'Show less' : 'Show all'}</Text>
        </Button>
      ) : null}
    </View>
  );
}

/**
 * The ready/loading/error body of the tool detail sheet, split out so
 * tests can render each state without mounting the loading effect. Read
 * only: source, version history and recent runs, no Run now or Revert.
 */
export function ToolDetailBody({
  state,
  actions,
}: {
  state: ToolDetailBodyState;
  actions: ToolDetailBodyActions;
}) {
  if (state.status === 'loading') {
    return <Text className="px-2 text-[13px] text-muted-foreground">Loading…</Text>;
  }
  if (state.status === 'error') {
    return (
      <View className="gap-2 px-2">
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {state.message}
        </Text>
        <View className="flex-row gap-2">
          <Button variant="outline" onPress={actions.onRetry} className="self-start">
            <Text>Retry</Text>
          </Button>
          <Button variant="ghost" onPress={actions.onClose} className="self-start">
            <Text>Back</Text>
          </Button>
        </View>
      </View>
    );
  }
  const { tool, versions, runs, shownVersion, shownSource, sourceError, versionBusy } = state;
  const busyAny = state.actionBusy || state.runBusy || state.deleteBusy;
  const currentVersion = shownVersion ?? tool.currentVersion;
  const shownHosts =
    versions.find((version) => version.version === shownVersion)?.hosts ?? tool.hosts;
  const approvedHosts = tool.approvedHosts ?? [];
  const waiting = waitingHosts(tool);
  return (
    <View className="gap-4">
      <View className="gap-1 px-2">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} className="min-w-0 flex-1 text-[16px] font-semibold">
            {tool.name}
          </Text>
          <Text className="shrink-0 font-mono text-[12px] text-muted-foreground">
            v{tool.currentVersion}
          </Text>
        </View>
        <Text className="text-[13px] text-muted-foreground">{tool.description}</Text>
        <Text className="text-[13px] text-muted-foreground">
          Contacts: {hostsLine(tool.hosts)}
          {tool.hosts.length > 0 ? ` · Approved: ${hostsLine(approvedHosts)}` : ''}
        </Text>
        {waiting.length > 0 ? (
          <Text className="text-[13px] text-muted-foreground">
            Waiting for approval: {hostsLine(waiting)}. Ask the AI to approve these hosts.
          </Text>
        ) : null}
        {tool.lastRunStatus !== null ? (
          <Text className="text-[13px] text-muted-foreground">Last run: {tool.lastRunStatus}</Text>
        ) : null}
      </View>

      <View accessibilityLabel="Source" className="gap-2">
        <Text className="px-2 text-[13px] font-semibold text-muted-foreground">
          Source (v{currentVersion}, read-only)
        </Text>
        {sourceError !== '' ? (
          <Text accessibilityRole="alert" className="px-2 text-[13px] text-danger">
            {sourceError}
          </Text>
        ) : null}
        {shownSource !== null ? (
          <ScrollView horizontal className="px-2">
            <View className="gap-0.5">
              {numberedLines(shownSource).map((line) => (
                <View key={line.n} className="flex-row gap-2">
                  <Text className="w-8 shrink-0 text-right font-mono text-[12px] text-muted-foreground">
                    {line.n}
                  </Text>
                  <Text className="font-mono text-[12px] text-foreground">{line.text}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        ) : null}
        {shownVersion !== null && shownVersion !== tool.currentVersion ? (
          <Text className="px-2 text-[13px] text-muted-foreground">
            Showing v{shownVersion} ({hostsLine(shownHosts)}); revert to make it current.
          </Text>
        ) : null}
      </View>

      <View accessibilityLabel="Version history" className="gap-1">
        <Text className="px-2 text-[13px] font-semibold text-muted-foreground">
          Version history
        </Text>
        {versions.length === 0 ? (
          <StateMessage kind="empty" size="inline" title="No versions yet." />
        ) : null}
        {versions.map((version) => {
          const confirming = state.confirmingRevert === version.version;
          return (
            <View key={version.id} className="gap-0.5 px-2 py-1.5">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Show source of v${version.version}`}
                disabled={versionBusy || state.actionBusy}
                onPress={() => actions.onShowVersion(version.version)}
                className="gap-0.5 active:bg-list-hover"
              >
                <Text numberOfLines={1} className="text-[14px] text-foreground">
                  v{version.version} · {version.message}
                </Text>
                <Text numberOfLines={2} className="text-[12px] text-muted-foreground">
                  {hostsLine(version.hosts)} · by {version.createdBy} ·{' '}
                  {new Date(version.createdAt).toLocaleString()}
                </Text>
              </Pressable>
              {version.version === tool.currentVersion ? null : confirming ? (
                <View className="gap-1">
                  <Text className="text-[13px] text-foreground">
                    Revert to v{version.version}? This creates a new version copying that
                    version&apos;s code.
                  </Text>
                  <View className="flex-row gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      accessibilityLabel={`Confirm revert to v${version.version}`}
                      disabled={busyAny}
                      onPress={() => actions.onConfirmRevert(version.version)}
                      className="shrink-0"
                    >
                      <Text>{state.actionBusy ? 'Reverting…' : 'Revert'}</Text>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyAny}
                      onPress={actions.onCancelRevert}
                    >
                      <Text>Cancel</Text>
                    </Button>
                  </View>
                </View>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  accessibilityLabel={`Revert to v${version.version}`}
                  disabled={versionBusy || busyAny}
                  onPress={() => actions.onAskRevert(version.version)}
                  className="shrink-0 self-start"
                >
                  <Text>Revert to v{version.version}</Text>
                </Button>
              )}
            </View>
          );
        })}
        {state.actionError !== '' ? (
          <Text accessibilityRole="alert" className="px-2 text-[13px] text-danger">
            {state.actionError}
          </Text>
        ) : null}
      </View>

      <View accessibilityLabel="Run now" className="gap-2">
        <Text className="px-2 text-[13px] font-semibold text-muted-foreground">Run now</Text>
        <View className="gap-1 px-2">
          <Text className="text-[13px] text-muted-foreground">Optional JSON input (max 4 KB)</Text>
          <TextField
            value={state.runInput}
            onChangeText={actions.onRunInput}
            multiline
            numberOfLines={3}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder='e.g. {"city": "Madrid"}'
            accessibilityLabel="Run input (JSON)"
            className="min-h-[60px] font-mono text-[13px]"
          />
        </View>
        {state.runInputError !== '' ? (
          <Text accessibilityRole="alert" className="px-2 text-[13px] text-danger">
            {state.runInputError}
          </Text>
        ) : null}
        <View className="px-2">
          <Button
            accessibilityLabel="Run now"
            disabled={busyAny}
            onPress={actions.onRun}
            className="self-start"
          >
            <Text>{state.runBusy ? 'Running…' : 'Run now'}</Text>
          </Button>
        </View>
        {state.runError !== '' ? (
          <Text accessibilityRole="alert" className="px-2 text-[13px] text-danger">
            {state.runError}
          </Text>
        ) : null}
        {state.runResult !== null ? (
          <RunResultBlock
            result={state.runResult}
            expanded={state.expandedResult}
            onToggle={actions.onToggleResult}
          />
        ) : null}
      </View>

      <View accessibilityLabel="Recent runs" className="gap-1">
        <Text className="px-2 text-[13px] font-semibold text-muted-foreground">Recent runs</Text>
        {runs.length === 0 ? (
          <StateMessage kind="empty" size="inline" title="No runs yet." />
        ) : null}
        {runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            expanded={actions.expandedOutputs.has(run.id)}
            onToggleOutput={() => actions.onToggleOutput(run.id)}
          />
        ))}
      </View>

      <View className="gap-2 px-2">
        {state.confirmingDelete ? (
          <View className="gap-1">
            <Text className="text-[13px] text-foreground">
              Delete {tool.name}? This deletes the tool and its routines. This cannot be undone.
            </Text>
            <View className="flex-row gap-2">
              <Button
                variant="destructive"
                size="sm"
                accessibilityLabel={`Confirm deleting ${tool.name}`}
                disabled={busyAny}
                onPress={actions.onConfirmDelete}
                className="shrink-0"
              >
                <Text>{state.deleteBusy ? 'Deleting…' : 'Delete'}</Text>
              </Button>
              <Button variant="ghost" size="sm" disabled={busyAny} onPress={actions.onCancelDelete}>
                <Text>Cancel</Text>
              </Button>
            </View>
          </View>
        ) : (
          <View>
            <Button
              variant="destructive"
              disabled={busyAny}
              onPress={actions.onAskDelete}
              className="self-start"
            >
              <Text>Delete tool</Text>
            </Button>
          </View>
        )}
        {state.deleteError !== '' ? (
          <Text accessibilityRole="alert" className="px-2 text-[13px] text-danger">
            {state.deleteError}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

type LoadedDetail = {
  tool: ToolDetail;
  versions: ToolVersion[];
  runs: ToolRun[];
};

/**
 * A revert, run or delete that failed. `source` is the original error, which
 * changeErrorMessage and runErrorMessage read (a status and an instance check).
 */
class ToolCallFailed extends Data.TaggedError('ToolCallFailed')<{ readonly source: unknown }> {}

/** One tool call as an Effect; a rejection becomes a ToolCallFailed with the same error. */
function toolCall<A>(call: () => Promise<A>): Effect.Effect<A, ToolCallFailed> {
  return Effect.tryPromise({ try: call, catch: (source) => new ToolCallFailed({ source }) });
}

/**
 * The message of a failed call, or '' when there is none. A call that runs
 * again shows no old error: the state keeps the last failure while it waits.
 */
function failureText<A, E>(state: ActionState<A, E>, text: (failure: E) => string): string {
  if (isWaiting(state)) return '';
  const failure = failureOf(state);
  return failure === undefined ? '' : text(failure);
}

/**
 * A full-height sheet with one tool's source, version history and recent
 * runs (read only). Tapping a history row shows that version's source;
 * `toolId` null hides the sheet.
 */
export function ToolDetailSheet({
  api,
  toolId,
  onClose,
  onDeleted,
}: {
  api: ToolDetailsApi & ToolActionsApi;
  toolId: string | null;
  onClose: () => void;
  onDeleted: (toolId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={toolId !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <View className="flex-1 bg-background" style={{ paddingTop: Math.max(insets.top, 16) }}>
          {toolId !== null ? (
            <ToolDetailLoader
              key={toolId}
              api={api}
              toolId={toolId}
              onClose={onClose}
              onDeleted={onDeleted}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ToolDetailLoader({
  api,
  toolId,
  onClose,
  onDeleted,
}: {
  api: ToolDetailsApi & ToolActionsApi;
  toolId: string;
  onClose: () => void;
  onDeleted: (toolId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const scheme = asColorScheme(colorScheme);
  const [loaded, setLoaded] = useState<LoadedDetail | null>(null);
  const [shownVersion, setShownVersion] = useState<number | null>(null);
  const [shownSource, setShownSource] = useState<string | null>(null);
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(new Set());
  const [confirmingRevert, setConfirmingRevert] = useState<number | null>(null);
  const [runInput, setRunInput] = useState('');
  const [runInputError, setRunInputError] = useState('');
  const [runResult, setRunResult] = useState<ToolRunResult | null>(null);
  const [expandedResult, setExpandedResult] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const actionRef = useRef(false);
  // Frees the one-action-at-a-time guard when a revert, run or delete ends.
  const releaseAction = (): Effect.Effect<void> =>
    Effect.sync(() => {
      actionRef.current = false;
    });

  const setRunsOnly = (runs: ToolRun[]): void => {
    setLoaded((current) =>
      current === null ? current : { tool: current.tool, versions: current.versions, runs },
    );
  };

  // The three reads run together. A retry or a revert calls reloadDetail;
  // the rows stay on screen while that reload runs.
  const [loadState, reloadDetail] = useQuery(
    () =>
      Effect.all(
        [
          fromApi(() => api.getTool(toolId)),
          fromApi(() => api.listToolVersions(toolId)),
          fromApi(() => api.listToolRuns(toolId)),
        ],
        { concurrency: 'unbounded' },
      ).pipe(
        Effect.tap(([tool, versions, runs]) =>
          Effect.sync(() => {
            setLoaded({ tool, versions, runs });
            setShownVersion(tool.currentVersion);
            setShownSource(tool.source);
          }),
        ),
      ),
    [api, toolId],
  );

  const [versionState, pickVersion, versionControls] = useAction((version: number) =>
    fromApi(() => api.getToolVersion(toolId, version)).pipe(
      Effect.tap((versionDetail) =>
        Effect.sync(() => {
          setShownVersion(versionDetail.version);
          setShownSource(versionDetail.source);
        }),
      ),
    ),
  );

  // One action at a time: a revert, run or delete in flight blocks the
  // others, like `runningRef` in `routines-section.tsx`.
  const [revertState, startRevert, revertControls] = useAction((version: number) =>
    toolCall(() => api.revertTool(toolId, version)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          setConfirmingRevert(null);
          reloadDetail();
        }),
      ),
      Effect.tapError(() => Effect.sync(() => setConfirmingRevert(null))),
      Effect.ensuring(releaseAction()),
    ),
  );

  const [runState, startRun, runControls] = useAction((input: unknown) =>
    toolCall(() =>
      input === undefined ? api.runToolNow(toolId) : api.runToolNow(toolId, input),
    ).pipe(
      Effect.tap((result) => Effect.sync(() => setRunResult(result))),
      // The run itself succeeded: a failed history refresh must not turn it
      // into an error, the old list simply stays.
      Effect.tap(() =>
        fromApi(() => api.listToolRuns(toolId)).pipe(
          Effect.tap((runs) => Effect.sync(() => setRunsOnly(runs))),
          Effect.ignore,
        ),
      ),
      Effect.ensuring(releaseAction()),
    ),
  );

  // Uninterruptible: closing the sheet mid-delete unmounts it, and the list
  // must still drop the tool once the delete has gone through.
  const [deleteState, startDelete, deleteControls] = useAction((id: string) =>
    Effect.uninterruptible(
      toolCall(() => api.deleteTool(id)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setConfirmingDelete(false);
            onDeleted(toolId);
          }),
        ),
        Effect.tapError(() => Effect.sync(() => setConfirmingDelete(false))),
      ),
    ).pipe(Effect.ensuring(releaseAction())),
  );

  const showVersion = (version: number): void => {
    if (loaded === null) return;
    if (version === loaded.tool.currentVersion) {
      versionControls.reset();
      setShownVersion(version);
      setShownSource(loaded.tool.source);
      return;
    }
    pickVersion(version);
  };

  const toggleOutput = (runId: string): void => {
    setExpandedOutputs((current) => {
      const next = new Set(current);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  const revert = (version: number): void => {
    if (actionRef.current) return;
    actionRef.current = true;
    revertControls.reset();
    startRevert(version);
  };

  const run = (): void => {
    if (actionRef.current) return;
    setRunInputError('');
    runControls.reset();
    setRunResult(null);
    setExpandedResult(false);
    const parsed = parseRunInput(runInput);
    if (!parsed.ok) {
      setRunInputError(parsed.message);
      return;
    }
    actionRef.current = true;
    startRun(parsed.input);
  };

  const remove = (): void => {
    if (actionRef.current) return;
    actionRef.current = true;
    deleteControls.reset();
    startDelete(toolId);
  };

  const loadStatus: 'loading' | 'ready' | 'error' = AsyncResult.isFailure(loadState)
    ? 'error'
    : AsyncResult.isSuccess(loadState)
      ? 'ready'
      : 'loading';
  const versionBusy = isWaiting(versionState);
  const sourceError = failureText(versionState, () => TOOL_VERSION_LOAD_FAILED_MESSAGE);
  const actionBusy = isWaiting(revertState);
  const actionError = failureText(revertState, (failure) =>
    changeErrorMessage(failure.source, REVERT_FAILED_MESSAGE),
  );
  const runBusy = isWaiting(runState);
  const runError = failureText(runState, (failure) => runErrorMessage(failure.source));
  const deleteBusy = isWaiting(deleteState);
  const deleteError = failureText(deleteState, (failure) =>
    changeErrorMessage(failure.source, DELETE_FAILED_MESSAGE),
  );

  const bodyState: ToolDetailBodyState =
    loadStatus === 'error' || (loadStatus === 'ready' && loaded === null)
      ? { status: 'error', message: TOOL_DETAIL_LOAD_FAILED_MESSAGE }
      : loadStatus === 'ready' && loaded !== null
        ? {
            status: 'ready',
            tool: loaded.tool,
            versions: loaded.versions,
            runs: loaded.runs,
            shownVersion,
            shownSource,
            sourceError,
            versionBusy,
            confirmingRevert,
            actionBusy,
            actionError,
            runInput,
            runInputError,
            runError,
            runBusy,
            runResult,
            expandedResult,
            confirmingDelete,
            deleteBusy,
            deleteError,
          }
        : { status: 'loading' };

  return (
    <>
      <View className="flex-row items-center gap-2 border-b border-divider px-2 py-2">
        <Text numberOfLines={1} className="min-w-0 flex-1 text-[16px] font-semibold">
          {loaded?.tool.name ?? 'Tool'}
        </Text>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          accessibilityLabel="Close tool"
          onPress={onClose}
        >
          <X size={20} color={MUTED_FOREGROUND[scheme]} />
        </Button>
      </View>
      <ScrollView
        className="flex-1 py-2"
        keyboardShouldPersistTaps={SHEET_SCROLL_TAPS_PERSIST}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 16 }}
      >
        <ToolDetailBody
          state={bodyState}
          actions={{
            onRetry: () => reloadDetail(),
            onClose,
            onShowVersion: showVersion,
            onToggleOutput: toggleOutput,
            expandedOutputs,
            onAskRevert: (version) => {
              revertControls.reset();
              setConfirmingRevert(version);
            },
            onCancelRevert: () => setConfirmingRevert(null),
            onConfirmRevert: revert,
            onRunInput: setRunInput,
            onRun: run,
            onToggleResult: () => setExpandedResult((current) => !current),
            onAskDelete: () => {
              deleteControls.reset();
              setConfirmingDelete(true);
            },
            onCancelDelete: () => setConfirmingDelete(false),
            onConfirmDelete: remove,
          }}
        />
      </ScrollView>
    </>
  );
}
