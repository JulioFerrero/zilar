import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { fromApi } from '@/lib/effect/api-effect';
import { type ActionState, failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import type {
  ToolActionsApi,
  ToolDetail,
  ToolDetailsApi,
  ToolRun,
  ToolRunResult,
  ToolVersion,
} from '@/lib/tools-api';

import { ToolDetailBody, type ToolDetailBodyState } from './tool-detail-body';
import {
  DELETE_FAILED_MESSAGE,
  REVERT_FAILED_MESSAGE,
  changeErrorMessage,
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

export function ToolDetailLoader({
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
          <X size={20} color={MUTED_FOREGROUND} />
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
