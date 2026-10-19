import { ApiError } from '@zilar/api-contract';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { Pressable, View, Modal } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { useQuery } from '@/lib/effect/use-query';
import { hostsLine, toolLastRunText } from '@/lib/routines-format';
import type {
  AiToolsApi,
  ToolListItem,
  ToolsApi,
  ToolActionsApi,
  ToolDetailsApi,
} from '@/lib/tools-api';
import { ToolDetailLoader } from './tool-detail-loader';
import { SectionError } from './routines-section';

function ToolDetailSheet({
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
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
  error instanceof ApiError && (error.status === 404 || error.code === 'invalid_response');

export const loadAiToolsEffect = (
  api: ToolsApi,
  aiId: string,
): Effect.Effect<ToolListItem[], unknown> =>
  Effect.tryPromise({ try: () => api.listAiTools(aiId), catch: (error) => error }).pipe(
    Effect.catchIf(isEmptyListError, () => Effect.succeed([])),
  );

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
    return <SectionError message={state.message} onRetry={onRetry} />;
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

/** Closes the sheet and reloads the list, so a run or a revert inside it shows up once the sheet is gone. */
export function closeDetailSheet(setOpenId: (id: string | null) => void, bump: () => void): void {
  setOpenId(null);
  bump();
}

export function withoutTool(tools: ToolListItem[], toolId: string): ToolListItem[] {
  return tools.filter((tool) => tool.id !== toolId);
}

export function ToolsSection({ api, aiId }: { api: AiToolsApi; aiId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<ReadonlyArray<string>>([]);
  // A refresh keeps the rows on screen until the reload answers; loading shows only before the first list.
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
