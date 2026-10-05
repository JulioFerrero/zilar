import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { createMockToolsApi } from '@/mock/tools';
import type { ToolDetail, ToolRun, ToolVersion } from '@/lib/tools-api';

import {
  SHEET_SCROLL_TAPS_PERSIST,
  TOOL_DETAIL_LOAD_FAILED_MESSAGE,
  ToolDetailBody,
  ToolDetailSheet,
  type ToolDetailBodyActions,
  type ToolDetailBodyState,
} from './tool-detail-sheet';
import type { ToolRunResult } from '@/lib/tools-api';

vi.mock('react-native', () => ({
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: ({
    children,
    ...props
  }: {
    children?: ReactNode;
    keyboardShouldPersistTaps?: string;
  }) => {
    if (props.keyboardShouldPersistTaps !== undefined) {
      capturedScrollProps = props;
    }
    return createElement('ScrollView', props, children);
  },
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'light' }),
}));

vi.mock('lucide-react-native', () => ({
  X: 'X',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/button', () => ({
  Button: 'Button',
}));

let capturedScrollProps: { keyboardShouldPersistTaps?: string } | undefined;

function idleActions(overrides: Partial<ToolDetailBodyActions> = {}): ToolDetailBodyActions {
  return {
    onRetry: () => {},
    onClose: () => {},
    onShowVersion: () => {},
    onToggleOutput: () => {},
    expandedOutputs: new Set(),
    onAskRevert: () => {},
    onCancelRevert: () => {},
    onConfirmRevert: () => {},
    onRunInput: () => {},
    onRun: () => {},
    onToggleResult: () => {},
    onAskDelete: () => {},
    onCancelDelete: () => {},
    onConfirmDelete: () => {},
    ...overrides,
  };
}

function content(
  state: ToolDetailBodyState,
  actions: ToolDetailBodyActions = idleActions(),
): string {
  return renderToStaticMarkup(createElement(ToolDetailBody, { state, actions }));
}

async function readyState(options: {
  toolId?: string;
  shownVersion?: number | null;
  sourceError?: string;
  expandedOutputs?: Set<string>;
}): Promise<{ state: ToolDetailBodyState; actions: ToolDetailBodyActions }> {
  const api = createMockToolsApi();
  const toolId = options.toolId ?? 'tool-1';
  const tool: ToolDetail = await api.getTool(toolId);
  const versions: ToolVersion[] = await api.listToolVersions(toolId);
  const runs: ToolRun[] = await api.listToolRuns(toolId);
  const shownVersion =
    options.shownVersion === undefined ? tool.currentVersion : options.shownVersion;
  const shownSource =
    shownVersion === null
      ? null
      : shownVersion === tool.currentVersion
        ? tool.source
        : (await api.getToolVersion(toolId, shownVersion)).source;
  return {
    state: {
      status: 'ready',
      tool,
      versions,
      runs,
      shownVersion,
      shownSource,
      sourceError: options.sourceError ?? '',
      versionBusy: false,
      confirmingRevert: null,
      actionBusy: false,
      actionError: '',
      runInput: '',
      runInputError: '',
      runError: '',
      runBusy: false,
      runResult: null,
      expandedResult: false,
      confirmingDelete: false,
      deleteBusy: false,
      deleteError: '',
    },
    actions: idleActions({
      expandedOutputs: options.expandedOutputs ?? new Set(),
    }),
  };
}

describe('ToolDetailBody', () => {
  it('shows the loading line while loading', () => {
    expect(content({ status: 'loading' })).toContain('Loading…');
  });

  it('shows the fixed error line with Retry and Back', () => {
    const html = content(
      { status: 'error', message: TOOL_DETAIL_LOAD_FAILED_MESSAGE },
      idleActions(),
    );
    expect(html).toContain(TOOL_DETAIL_LOAD_FAILED_MESSAGE);
    expect(html).toContain('Retry');
    expect(html).toContain('Back');
  });

  it('shows the mock tool with hosts, numbered source, history and runs', async () => {
    const { state, actions } = await readyState({});
    const html = content(state, actions);
    expect(html).toContain('Morning briefing');
    expect(html).toContain('v3');
    expect(html).toContain('Contacts: news.example.com, api.example.com');
    expect(html).toContain('Source (v3, read-only)');
    expect(html).toContain('summarize(headlines)');
    expect(html).toContain('Show source of v2');
    expect(html).toContain('v2 · Add the API host');
    expect(html).toContain('error (timeout)');
    expect(html).toContain('Failed: timeout');
    expect(html).toContain('Show all');
    expect(html).toContain('Last run: ok');
  });

  it('shows the waiting line when a host is not approved', async () => {
    const { state, actions } = await readyState({});
    const html = content(state, actions);
    expect(html).not.toContain('Waiting for approval');
    const waiting =
      state.status === 'ready'
        ? {
            ...state,
            tool: { ...state.tool, approvedHosts: ['news.example.com'] },
          }
        : state;
    expect(content(waiting, actions)).toContain(
      'Waiting for approval: api.example.com. Ask the AI to approve these hosts.',
    );
  });

  it('notes the older version with its hosts under the source', async () => {
    const { state, actions } = await readyState({ shownVersion: 1 });
    const html = content(state, actions);
    expect(html).toContain('Showing v1 (no sites); revert to make it current.');
  });

  it('shows the version error above the source', async () => {
    const { state, actions } = await readyState({ sourceError: 'Could not load that version.' });
    expect(content(state, actions)).toContain('Could not load that version.');
  });

  it('shows the empty lines for a tool with one version and no runs', async () => {
    const { state, actions } = await readyState({ toolId: 'tool-2' });
    const html = content(state, actions);
    expect(html).toContain('Draft helper');
    expect(html).toContain('Contacts: no sites');
    expect(html).toContain('No runs yet.');
    expect(html).not.toContain('No versions yet.');
  });

  it('shows the empty history line when there are no versions', async () => {
    const { state, actions } = await readyState({});
    const empty = state.status === 'ready' ? { ...state, versions: [] } : state;
    expect(content(empty, actions)).toContain('No versions yet.');
  });

  it('expands the truncated run output with Show less', async () => {
    const { state } = await readyState({});
    const runs = state.status === 'ready' ? state.runs : [];
    const long = runs.find((run) => run.id === 'run-3');
    if (long === undefined) throw new Error('expected the long mock run');
    const expanded = await readyState({ expandedOutputs: new Set([long.id]) });
    expect(content(expanded.state, expanded.actions)).toContain('Show less');
  });

  it('wires Retry and Back to the callbacks', () => {
    const actions = idleActions({
      onRetry: vi.fn(),
      onClose: vi.fn(),
      onShowVersion: vi.fn(),
    });
    const errorTree = ToolDetailBody({
      state: { status: 'error', message: TOOL_DETAIL_LOAD_FAILED_MESSAGE },
      actions,
    });
    const errorButtons = (
      Array.isArray(errorTree.props.children) ? errorTree.props.children : []
    ) as { props?: { children?: { props?: { onPress?: () => void } }[] } }[];
    for (const row of errorButtons) {
      for (const button of row.props?.children ?? []) {
        button.props?.onPress?.();
      }
    }
    expect(actions.onRetry).toHaveBeenCalledTimes(1);
    expect(actions.onClose).toHaveBeenCalledTimes(1);
  });

  it('wires a history row to its version', async () => {
    const onShowVersion = vi.fn();
    const { state } = await readyState({});
    const tree = ToolDetailBody({ state, actions: idleActions({ onShowVersion }) });
    const presses: (() => void)[] = [];
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const element = node as {
        props?: { onPress?: () => void; accessibilityLabel?: string; children?: unknown };
      };
      if (element.props?.accessibilityLabel === 'Show source of v2' && element.props.onPress) {
        presses.push(element.props.onPress);
      }
      visit(element.props?.children);
    };
    visit(tree);
    expect(presses).toHaveLength(1);
    presses[0]?.();
    expect(onShowVersion).toHaveBeenCalledWith(2);
  });

  it('shows Revert only on non-current rows', async () => {
    const { state, actions } = await readyState({});
    const html = content(state, actions);
    expect(html).toContain('Revert to v2');
    expect(html).toContain('Revert to v1');
    expect(html).not.toContain('Revert to v3');
  });

  it('shows the revert confirm with the copy text', async () => {
    const { state, actions } = await readyState({});
    const confirming = state.status === 'ready' ? { ...state, confirmingRevert: 2 } : state;
    const html = content(confirming, actions);
    expect(html).toContain('Revert to v2? This creates a new version copying that version');
    expect(html).toContain('Cancel');
  });

  it('shows the Run now section with the input label and placeholder', async () => {
    const { state, actions } = await readyState({});
    const html = content(state, actions);
    expect(html).toContain('Run now');
    expect(html).toContain('Optional JSON input (max 4 KB)');
    expect(html).toContain('Run input (JSON)');
  });

  it('disables autocapitalize and autocorrect on the run input', async () => {
    const { state, actions } = await readyState({});
    const tree = ToolDetailBody({ state, actions });
    type InputProps = {
      accessibilityLabel?: string;
      autoCapitalize?: string;
      autoCorrect?: boolean;
      children?: ReactNode;
    };
    const inputs: ReactElement<InputProps>[] = [];
    const visit = (node: ReactNode): void => {
      Children.forEach(node, (child) => {
        if (!isValidElement<InputProps>(child)) return;
        if (child.type === 'TextInput') {
          inputs.push(child as ReactElement<InputProps>);
          return;
        }
        visit(child.props.children);
      });
    };
    visit(tree);
    const runInput = inputs.find((input) => input.props.accessibilityLabel === 'Run input (JSON)');
    if (runInput === undefined) throw new Error('expected the run input');
    expect(runInput.props.autoCapitalize).toBe('none');
    expect(runInput.props.autoCorrect).toBe(false);
  });

  it('shows the run input error', async () => {
    const { state, actions } = await readyState({});
    const withError =
      state.status === 'ready' ? { ...state, runInputError: 'Input must be valid JSON.' } : state;
    expect(content(withError, actions)).toContain('Input must be valid JSON.');
  });

  it('shows the ok result with the timing line and output', async () => {
    const { state, actions } = await readyState({});
    const result: ToolRunResult = {
      ok: true,
      output: { text: 'headlines' },
      logs: '',
      durationMs: 120,
      fetchCount: 1,
    };
    const withResult = state.status === 'ready' ? { ...state, runResult: result } : state;
    const html = content(withResult, actions);
    expect(html).toContain('Ok in 120 ms · 1 fetch');
    expect(html).toContain('headlines');
  });

  it('shows the failed result with kind, message and logs', async () => {
    const { state, actions } = await readyState({});
    const result: ToolRunResult = {
      ok: false,
      error: { kind: 'timeout', message: 'The tool took too long.' },
      logs: 'started',
      durationMs: 5000,
      fetchCount: 0,
    };
    const withResult = state.status === 'ready' ? { ...state, runResult: result } : state;
    const html = content(withResult, actions);
    expect(html).toContain('Failed: timeout');
    expect(html).toContain('The tool took too long.');
    expect(html).toContain('started');
  });

  it('shows the Running… and Reverting… busy labels', async () => {
    const { state, actions } = await readyState({});
    const running = state.status === 'ready' ? { ...state, runBusy: true } : state;
    expect(content(running, actions)).toContain('Running…');
    const reverting =
      state.status === 'ready' ? { ...state, confirmingRevert: 2, actionBusy: true } : state;
    expect(content(reverting, actions)).toContain('Reverting…');
  });

  it('shows the delete confirm with the irreversible text', async () => {
    const { state, actions } = await readyState({});
    const confirming = state.status === 'ready' ? { ...state, confirmingDelete: true } : state;
    const html = content(confirming, actions);
    expect(html).toContain(
      'Delete Morning briefing? This deletes the tool and its routines. This cannot be undone.',
    );
    const idle = content(state, actions);
    expect(idle).toContain('Delete tool');
  });

  it('shows the Deleting… busy label', async () => {
    const { state, actions } = await readyState({});
    const deleting =
      state.status === 'ready' ? { ...state, confirmingDelete: true, deleteBusy: true } : state;
    expect(content(deleting, actions)).toContain('Deleting…');
  });

  it('disables Run now and Delete tool while a revert runs', async () => {
    const { state, actions } = await readyState({});
    const busy = state.status === 'ready' ? { ...state, actionBusy: true } : state;
    const tree = ToolDetailBody({ state: busy, actions });
    type ButtonProps = { accessibilityLabel?: string; disabled?: boolean; children?: ReactNode };
    const buttons: ReactElement<ButtonProps>[] = [];
    const visit = (node: ReactNode): void => {
      Children.forEach(node, (child) => {
        if (!isValidElement<ButtonProps>(child)) return;
        if (child.type === 'Button') {
          buttons.push(child as ReactElement<ButtonProps>);
          return;
        }
        visit(child.props.children);
      });
    };
    visit(tree);
    const runNow = buttons.find((button) => button.props.accessibilityLabel === 'Run now');
    if (runNow === undefined) throw new Error('expected the Run now button');
    expect(runNow.props.disabled).toBe(true);
    const deleteTool = buttons.find(
      (button) =>
        button.props.accessibilityLabel === undefined &&
        renderToStaticMarkup(button).includes('Delete tool'),
    );
    if (deleteTool === undefined) throw new Error('expected the Delete tool button');
    expect(deleteTool.props.disabled).toBe(true);
  });

  it('keeps Run taps while the keyboard is open (persisted taps)', () => {
    expect(SHEET_SCROLL_TAPS_PERSIST).toBe('handled');
    capturedScrollProps = undefined;
    const html = renderToStaticMarkup(
      createElement(ToolDetailSheet, {
        api: createMockToolsApi(),
        toolId: 'tool-1',
        onClose: () => {},
        onDeleted: () => {},
      }),
    );
    if (capturedScrollProps === undefined) throw new Error('expected the vertical ScrollView');
    const tapsProps: { keyboardShouldPersistTaps?: string } = capturedScrollProps;
    expect(tapsProps.keyboardShouldPersistTaps).toBe('handled');
    expect(html).toContain('keyboardShouldPersistTaps="handled"');
  });
});
