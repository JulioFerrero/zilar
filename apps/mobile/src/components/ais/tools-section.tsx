import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
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

/**
 * Loads one AI's tools. A 404 or an unparseable response reads as an empty
 * list, not an error (web does the same); any other failure throws.
 */
export async function loadAiTools(api: ToolsApi, aiId: string): Promise<ToolListItem[]> {
  try {
    return await api.listAiTools(aiId);
  } catch (error) {
    if (
      error instanceof ToolsApiError &&
      (error.status === 404 || error.code === 'invalid_response')
    ) {
      return [];
    }
    throw error;
  }
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
    return <Text className="px-2 text-[13px] text-muted-foreground">Loading…</Text>;
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
    return <Text className="px-2 text-[13px] text-muted-foreground">{TOOLS_EMPTY_MESSAGE}</Text>;
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
 * The Tools section of the AI edit screen (T-0189, read only): every tool
 * with name, version, description, hosts (declared, and approved when the
 * API gives them), and last run. Tapping a row opens the read-only detail
 * sheet (T-0218).
 */
export function ToolsSection({ api, aiId }: { api: AiToolsApi; aiId: string }) {
  const [state, setState] = useState<ToolsSectionState>({
    status: 'loading',
    tools: [],
    message: '',
  });
  const [reloadTick, setReloadTick] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const tools = await loadAiTools(api, aiId);
        if (!active) return;
        setState({ status: 'ready', tools, message: '' });
      } catch {
        if (!active) return;
        setState({ status: 'error', tools: [], message: TOOLS_LOAD_FAILED_MESSAGE });
      }
    })();
    return () => {
      active = false;
    };
  }, [api, aiId, reloadTick]);

  return (
    <View accessibilityLabel="Tools" className="gap-1">
      <Text className="px-2 text-[13px] font-semibold text-muted-foreground">Tools</Text>
      <ToolsSectionContent
        state={state}
        onRetry={() => setReloadTick((tick) => tick + 1)}
        onOpenTool={setOpenId}
      />
      <ToolDetailSheet api={api} toolId={openId} onClose={() => setOpenId(null)} />
    </View>
  );
}
