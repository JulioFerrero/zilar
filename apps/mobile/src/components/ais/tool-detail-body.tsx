import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { hostsLine } from '@/lib/routines-format';
import type { ToolDetail, ToolRun, ToolRunResult, ToolVersion } from '@/lib/tools-api';

import { numberedLines, waitingHosts } from './tool-detail-format';
import { RunResultBlock, RunRow } from './tool-run-blocks';

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
