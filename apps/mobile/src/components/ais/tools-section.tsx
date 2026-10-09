import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { runMobile } from '@/lib/effect/runtime';
import { useQuery } from '@/lib/effect/use-query';
import { hostsLine, toolLastRunText } from '@/lib/routines-format';
import { ToolsApiError, type AiToolsApi, type ToolListItem, type ToolsApi } from '@/lib/tools-api';

import { ToolDetailSheet } from './tool-detail-sheet';

/** Fixed user-facing line when the tools list fails to load. */
export const TOOLS_LOAD_FAILED_MESSAGE = 'Could not load the tools. Try again.';

export const TOOLS_EMPTY_MESSAGE =
  'No tools here yet. An AI can write small tools that run on a schedule — ask it in the chat.';

export type ToolsSectionState = {
  status: 'loading' | 'ready' | 'error';
  tools: ToolListItem[];
  message: string;
};

/** A 404 or an unparseable response: the list reads as empty, not as an error. */
const isEmptyListError = (error: unknown): boolean =>
  error instanceof ToolsApiError && (error.status === 404 || error.code === 'invalid_response');

/**
 * Loads one AI's tools. A 404 or an unparseable response reads as an empty
 * list, not an error (web does the same); any other failure stays a failure
 * with the original error.
 */
export const loadAiToolsEffect = (
  api: ToolsApi,
  aiId: string,
): Effect.Effect<ToolListItem[], unknown> =>
  Effect.tryPromise({ try: () => api.listAiTools(aiId), catch: (error) => error }).pipe(
    Effect.catchIf(isEmptyListError, () => Effect.succeed([])),
  );

/** Promise form of `loadAiToolsEffect`, the same rejection as before. */
export const loadAiTools = (api: ToolsApi, aiId: string): Promise<ToolListItem[]> =>
  runMobile(loadAiToolsEffect(api, aiId));

/** The section state the view renders: the load result minus the tools deleted here. */
export function sectionStateOf(
  load: AsyncResult.AsyncResult<ToolListItem[], unknown>,
  deletedIds: ReadonlyArray<string>,
): ToolsSectionState {
  if (AsyncResult.isSuccess(load)) {
    const tools = deletedIds.reduce(withoutTool, load.value);
    return { status: 'ready', tools, message: '' };
  }
  if (AsyncResult.isFailure(load)) {
    return { status: 'error', tools: [], message: TOOLS_LOAD_FAILED_MESSAGE };
  }
  return { status: 'loading', tools: [], message: '' };
}

function ToolRow({ tool, onOpen }: { tool: ToolListItem; onOpen: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${tool.name}`}
      onPress={onOpen}
      className="px-2 py-1.5 active:bg-list-hover"
    >
      <View className="flex-row items-center gap-1.5">
        <Text className="min-w-0 flex-1 truncate text-[14px] font-medium">{tool.name}</Text>
        <Text className="shrink-0 font-mono text-[12px] text-muted-foreground">
          v{tool.currentVersion}
        </Text>
      </View>
      <Text className="truncate text-[12px] text-muted-foreground">{tool.description}</Text>
      <Text className="truncate text-[12px] text-muted-foreground">
        {hostsLine(tool.hosts)}
        {tool.approvedHosts !== undefined && tool.hosts.length > 0
          ? ` · approved: ${hostsLine(tool.approvedHosts)}`
          : ''}{' '}
        · {toolLastRunText(tool)}
      </Text>
    </Pressable>
  );
}

/**
 * The ready/loading/error body of the tools list, split out so tests can
 * render each state without mounting the loading effect.
 */
export function ToolsSectionContent({
  state,
  onRetry,
  onOpenTool,
}: {
  state: ToolsSectionState;
  onRetry: () => void;
  onOpenTool?: (toolId: string) => void;
}) {
  if (state.status === 'loading') {
    return <StateMessage kind="loading" size="inline" title="Loading…" />;
  }
  if (state.status === 'error') {
    return (
      <View className="gap-2 px-2">
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {state.message}
        </Text>
        <Button variant="outline" onPress={onRetry} className="self-start">
          <Text>Retry</Text>
        </Button>
      </View>
    );
  }
  if (state.tools.length === 0) {
    return <StateMessage kind="empty" size="inline" title={TOOLS_EMPTY_MESSAGE} />;
  }
  return (
    <>
      {state.tools.map((tool) => (
        <ToolRow key={tool.id} tool={tool} onOpen={() => onOpenTool?.(tool.id)} />
      ))}
    </>
  );
}

/**
 * Closes the detail sheet (T-0230): the list reloads so a run or a revert
 * inside the sheet shows up once the sheet is gone. Pure so tests can cover
 * it without mounting the section.
 */
export function closeDetailSheet(setOpenId: (id: string | null) => void, bump: () => void): void {
  setOpenId(null);
  bump();
}

/**
 * Removes a deleted tool from the list (the sheet's `onDeleted` callback).
 * Pure so tests can cover it without mounting the section.
 */
export function withoutTool(tools: ToolListItem[], toolId: string): ToolListItem[] {
  return tools.filter((tool) => tool.id !== toolId);
}

/**
 * The Tools section of the AI edit screen (T-0189, read only): every tool
 * with name, version, description, hosts (declared, and approved when the
 * API gives them), and last run. Tapping a row opens the read-only detail
 * sheet (T-0218).
 */
export function ToolsSection({ api, aiId }: { api: AiToolsApi; aiId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<ReadonlyArray<string>>([]);
  // A refresh keeps the rows on screen until the reload answers. Loading…
  // shows only before the first list.
  const [load, reloadTools] = useQuery(() => loadAiToolsEffect(api, aiId), [api, aiId]);
  const state = sectionStateOf(load, deletedIds);

  return (
    <View accessibilityLabel="Tools" className="gap-1">
      <Text className="px-2 text-[13px] font-semibold text-muted-foreground">Tools</Text>
      <ToolsSectionContent state={state} onRetry={() => reloadTools()} onOpenTool={setOpenId} />
      <ToolDetailSheet
        api={api}
        toolId={openId}
        onClose={() => closeDetailSheet(setOpenId, () => reloadTools())}
        onDeleted={(toolId) => {
          setOpenId(null);
          setDeletedIds((ids) => [...ids, toolId]);
        }}
      />
    </View>
  );
}
