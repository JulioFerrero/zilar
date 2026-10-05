import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { hostsLine, truncateOutput } from '@/lib/routines-format';
import type { ToolDetail, ToolDetailsApi, ToolRun, ToolVersion } from '@/lib/tools-api';

import { numberedLines, runStatusText, waitingHosts } from './tool-detail-format';

/** Fixed user-facing line when the tool fails to load. */
export const TOOL_DETAIL_LOAD_FAILED_MESSAGE = 'Could not load the tool.';

/** Fixed user-facing line when one version's source fails to load. */
export const TOOL_VERSION_LOAD_FAILED_MESSAGE = 'Could not load that version.';

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
    };

export type ToolDetailBodyActions = {
  onRetry: () => void;
  onClose: () => void;
  onShowVersion: (version: number) => void;
  onToggleOutput: (runId: string) => void;
  expandedOutputs: Set<string>;
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Show less' : 'Show all'}
              onPress={onToggleOutput}
            >
              <Text className="text-[13px] text-foreground">
                {expanded ? 'Show less' : 'Show all'}
              </Text>
            </Pressable>
          ) : null}
        </View>
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
          <Text className="px-2 text-[13px] text-muted-foreground">No versions yet.</Text>
        ) : null}
        {versions.map((version) => (
          <Pressable
            key={version.id}
            accessibilityRole="button"
            accessibilityLabel={`Show source of v${version.version}`}
            disabled={versionBusy}
            onPress={() => actions.onShowVersion(version.version)}
            className="gap-0.5 px-2 py-1.5 active:bg-list-hover"
          >
            <Text numberOfLines={1} className="text-[14px] text-foreground">
              v{version.version} · {version.message}
            </Text>
            <Text numberOfLines={1} className="text-[12px] text-muted-foreground">
              {hostsLine(version.hosts)} · by {version.createdBy} ·{' '}
              {new Date(version.createdAt).toLocaleString()}
            </Text>
          </Pressable>
        ))}
      </View>

      <View accessibilityLabel="Recent runs" className="gap-1">
        <Text className="px-2 text-[13px] font-semibold text-muted-foreground">Recent runs</Text>
        {runs.length === 0 ? (
          <Text className="px-2 text-[13px] text-muted-foreground">No runs yet.</Text>
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
    </View>
  );
}

type LoadedDetail = {
  tool: ToolDetail;
  versions: ToolVersion[];
  runs: ToolRun[];
};

/**
 * A full-height sheet with one tool's source, version history and recent
 * runs (read only). Tapping a history row shows that version's source;
 * `toolId` null hides the sheet.
 */
export function ToolDetailSheet({
  api,
  toolId,
  onClose,
}: {
  api: ToolDetailsApi;
  toolId: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={toolId !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-background" style={{ paddingTop: Math.max(insets.top, 16) }}>
        {toolId !== null ? (
          <ToolDetailLoader key={toolId} api={api} toolId={toolId} onClose={onClose} />
        ) : null}
      </View>
    </Modal>
  );
}

function ToolDetailLoader({
  api,
  toolId,
  onClose,
}: {
  api: ToolDetailsApi;
  toolId: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const scheme = asColorScheme(colorScheme);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loaded, setLoaded] = useState<LoadedDetail | null>(null);
  const [shownVersion, setShownVersion] = useState<number | null>(null);
  const [shownSource, setShownSource] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState('');
  const [versionBusy, setVersionBusy] = useState(false);
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(new Set());
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [detail, history, recent] = await Promise.all([
          api.getTool(toolId),
          api.listToolVersions(toolId),
          api.listToolRuns(toolId),
        ]);
        if (!active) return;
        setLoaded({ tool: detail, versions: history, runs: recent });
        setShownVersion(detail.currentVersion);
        setShownSource(detail.source);
        setStatus('ready');
      } catch {
        if (!active) return;
        setStatus('error');
      }
    })();
    return () => {
      active = false;
    };
  }, [api, toolId, reloadTick]);

  const showVersion = (version: number): void => {
    if (loaded === null) return;
    if (version === loaded.tool.currentVersion) {
      setShownVersion(version);
      setShownSource(loaded.tool.source);
      setSourceError('');
      return;
    }
    setVersionBusy(true);
    setSourceError('');
    void (async () => {
      try {
        const detail = await api.getToolVersion(toolId, version);
        setShownVersion(detail.version);
        setShownSource(detail.source);
      } catch {
        setSourceError(TOOL_VERSION_LOAD_FAILED_MESSAGE);
      } finally {
        setVersionBusy(false);
      }
    })();
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

  const bodyState: ToolDetailBodyState =
    status === 'error' || (status === 'ready' && loaded === null)
      ? { status: 'error', message: TOOL_DETAIL_LOAD_FAILED_MESSAGE }
      : status === 'ready' && loaded !== null
        ? {
            status: 'ready',
            tool: loaded.tool,
            versions: loaded.versions,
            runs: loaded.runs,
            shownVersion,
            shownSource,
            sourceError,
            versionBusy,
          }
        : { status: 'loading' };

  return (
    <>
      <View className="flex-row items-center gap-2 border-b border-divider px-2 py-2">
        <Text numberOfLines={1} className="min-w-0 flex-1 text-[16px] font-semibold">
          {loaded?.tool.name ?? 'Tool'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close tool"
          onPress={onClose}
          className="p-2 active:bg-list-hover"
        >
          <X size={20} color={MUTED_FOREGROUND[scheme]} />
        </Pressable>
      </View>
      <ScrollView className="flex-1 py-2" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <ToolDetailBody
          state={bodyState}
          actions={{
            onRetry: () => setReloadTick((tick) => tick + 1),
            onClose,
            onShowVersion: showVersion,
            onToggleOutput: toggleOutput,
            expandedOutputs,
          }}
        />
      </ScrollView>
    </>
  );
}
