import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { createMockToolsApi } from '@/mock/tools';
import { ToolsApiError, type AiToolsApi, type ToolsApi } from '@/lib/tools-api';

import {
  ROUTINES_EMPTY_MESSAGE,
  ROUTINES_LOAD_FAILED_MESSAGE,
  ROUTINE_FORBIDDEN_MESSAGE,
  ROUTINE_NEEDS_APPROVAL_MESSAGE,
  ROUTINE_UPDATE_FAILED_MESSAGE,
  RoutinesSection,
  RoutinesSectionContent,
  applyRoutineAction,
  loadAiRoutines,
  routineActionMessage,
  type RoutineRowActions,
  type RoutinesSectionState,
} from './routines-section';

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'light' }),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  View: 'View',
}));

vi.mock('lucide-react-native', () => ({
  CircleAlert: 'CircleAlert',
  Inbox: 'Inbox',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/button', () => ({
  Button: 'Button',
}));

function content(state: RoutinesSectionState, onRetry: () => void = () => {}): string {
  return renderToStaticMarkup(createElement(RoutinesSectionContent, { state, onRetry }));
}

describe('RoutinesSectionContent', () => {
  it('shows the loading line while loading', () => {
    expect(content({ status: 'loading', routines: [], message: '' })).toContain('Loading…');
  });

  it('shows the mock routines with schedules, tools and statuses', async () => {
    const routines = await createMockToolsApi().listAiRoutines('ai-1');
    expect(routines).toHaveLength(3);
    const html = content({ status: 'ready', routines, message: '' });
    expect(html).toContain('Weekday briefing');
    expect(html).toContain('daily at 09:00 Europe/Madrid on Mon, Tue, Wed, Thu, Fri');
    expect(html).toContain('runs Morning briefing');
    expect(html).toContain('active');
    expect(html).toContain('Hourly drafts');
    expect(html).toContain('every 1 hour');
    expect(html).toContain('paused');
    expect(html).toContain('Paused after repeated failures. Ask the AI to fix it.');
  });

  it('shows the empty sentence when the list is empty', () => {
    const html = content({ status: 'ready', routines: [], message: '' });
    expect(html).toContain(ROUTINES_EMPTY_MESSAGE);
  });

  it('shows the fixed error line with a Retry button', () => {
    const html = content({
      status: 'error',
      routines: [],
      message: ROUTINES_LOAD_FAILED_MESSAGE,
    });
    expect(html).toContain(ROUTINES_LOAD_FAILED_MESSAGE);
    expect(html).toContain('Retry');
  });

  it('wires Retry to the reload callback', () => {
    const onRetry = vi.fn();
    const tree = RoutinesSectionContent({
      state: { status: 'error', routines: [], message: ROUTINES_LOAD_FAILED_MESSAGE },
      onRetry,
    }) as ReactElement<{ children: ReactElement[] }>;
    const children = tree.props.children as unknown as ReactElement<{ onPress?: () => void }>[];
    children
      .filter((child) => child.props.onPress !== undefined)
      .forEach((child) => child.props.onPress?.());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('RoutinesSection loading', () => {
  it('renders the heading with the loading line before the effect runs', () => {
    const api = createMockToolsApi();
    const html = renderToStaticMarkup(createElement(RoutinesSection, { api, aiId: 'ai-1' }));
    expect(html).toContain('Routines');
    expect(html).toContain('Loading…');
  });
});

describe('loadAiRoutines', () => {
  it('returns the routines on success', async () => {
    const routines = await loadAiRoutines(createMockToolsApi(), 'ai-1');
    expect(routines).toHaveLength(3);
  });

  it('reads a 404 as an empty list', async () => {
    const api: ToolsApi = {
      listAiTools: async () => [],
      listAiRoutines: async () => {
        throw new ToolsApiError(404, 'not_found', 'AI not found');
      },
    };
    await expect(loadAiRoutines(api, 'ai-gone')).resolves.toEqual([]);
  });

  it('reads an unparseable response as an empty list', async () => {
    const api: ToolsApi = {
      listAiTools: async () => [],
      listAiRoutines: async () => {
        throw new ToolsApiError(200, 'invalid_response', 'The server sent an unexpected response');
      },
    };
    await expect(loadAiRoutines(api, 'ai-1')).resolves.toEqual([]);
  });

  it('rethrows any other failure so the section shows the error with Retry', async () => {
    const api: ToolsApi = {
      listAiTools: async () => [],
      listAiRoutines: async () => {
        throw new ToolsApiError(0, 'network_error', 'Could not reach the server');
      },
    };
    await expect(loadAiRoutines(api, 'ai-1')).rejects.toMatchObject({ code: 'network_error' });
  });
});

describe('routineActionMessage', () => {
  it('maps needs_approval to the re-approval hint, never server text', () => {
    expect(
      routineActionMessage(new ToolsApiError(409, 'needs_approval', 'server says re-approve')),
    ).toEqual({ kind: 'hint', text: ROUTINE_NEEDS_APPROVAL_MESSAGE });
    expect(ROUTINE_NEEDS_APPROVAL_MESSAGE).toContain('needs re-approval');
  });

  it('maps 403 and 404 to the forbidden line', () => {
    expect(routineActionMessage(new ToolsApiError(403, 'forbidden', 'no'))).toEqual({
      kind: 'error',
      text: ROUTINE_FORBIDDEN_MESSAGE,
    });
    expect(routineActionMessage(new ToolsApiError(404, 'not_found', 'no'))).toEqual({
      kind: 'error',
      text: ROUTINE_FORBIDDEN_MESSAGE,
    });
    expect(ROUTINE_FORBIDDEN_MESSAGE).toBe('You may not change this routine.');
  });

  it('maps anything else, including network errors, to the generic line', () => {
    expect(
      routineActionMessage(new ToolsApiError(0, 'network_error', 'Could not reach the server')),
    ).toEqual({ kind: 'error', text: ROUTINE_UPDATE_FAILED_MESSAGE });
    expect(routineActionMessage(new ToolsApiError(500, 'request_failed', 'boom'))).toEqual({
      kind: 'error',
      text: ROUTINE_UPDATE_FAILED_MESSAGE,
    });
    expect(routineActionMessage(new Error('boom'))).toEqual({
      kind: 'error',
      text: ROUTINE_UPDATE_FAILED_MESSAGE,
    });
    expect(ROUTINE_UPDATE_FAILED_MESSAGE).toBe('Could not update the routine. Try again.');
  });
});

describe('applyRoutineAction', () => {
  it('pauses the active routine with the server row', async () => {
    const api = createMockToolsApi();
    const routines = await api.listAiRoutines('ai-1');
    const outcome = await applyRoutineAction(api, routines, 'routine-1', 'pause');
    expect(outcome.action).toBeNull();
    const row = outcome.routines.find((routine) => routine.id === 'routine-1');
    expect(row?.status).toBe('paused');
    expect(row?.pausedReason).toBe('user');
    expect(outcome.routines).toHaveLength(3);
  });

  it('resumes the failures routine back to active', async () => {
    const api = createMockToolsApi();
    const routines = await api.listAiRoutines('ai-1');
    const outcome = await applyRoutineAction(api, routines, 'routine-2', 'resume');
    expect(outcome.action).toBeNull();
    const row = outcome.routines.find((routine) => routine.id === 'routine-2');
    expect(row?.status).toBe('active');
    expect(row?.pausedReason).toBeNull();
  });

  it('keeps the list and shows the hint when resume answers needs_approval', async () => {
    const api = createMockToolsApi();
    const routines = await api.listAiRoutines('ai-1');
    const outcome = await applyRoutineAction(api, routines, 'routine-3', 'resume');
    expect(outcome.routines).toEqual(routines);
    expect(outcome.action).toEqual({ kind: 'hint', text: ROUTINE_NEEDS_APPROVAL_MESSAGE });
  });

  it('shows the forbidden line on 403 and 404 without touching the list', async () => {
    for (const status of [403, 404]) {
      const failing: AiToolsApi = {
        ...createMockToolsApi(),
        pauseRoutine: async () => {
          throw new ToolsApiError(status, 'not_found', 'Routine not found');
        },
      };
      const routines = await createMockToolsApi().listAiRoutines('ai-1');
      const outcome = await applyRoutineAction(failing, routines, 'routine-1', 'pause');
      expect(outcome.routines).toEqual(routines);
      expect(outcome.action).toEqual({ kind: 'error', text: ROUTINE_FORBIDDEN_MESSAGE });
    }
  });

  it('shows the generic line on a network error without touching the list', async () => {
    const failing: AiToolsApi = {
      ...createMockToolsApi(),
      resumeRoutine: async () => {
        throw new ToolsApiError(0, 'network_error', 'Could not reach the server');
      },
    };
    const routines = await createMockToolsApi().listAiRoutines('ai-1');
    const outcome = await applyRoutineAction(failing, routines, 'routine-2', 'resume');
    expect(outcome.routines).toEqual(routines);
    expect(outcome.action).toEqual({ kind: 'error', text: ROUTINE_UPDATE_FAILED_MESSAGE });
  });

  it('deletes the row and clears the message', async () => {
    const api = createMockToolsApi();
    const routines = await api.listAiRoutines('ai-1');
    const outcome = await applyRoutineAction(api, routines, 'routine-1', 'delete');
    expect(outcome.action).toBeNull();
    expect(outcome.routines.map((routine) => routine.id)).toEqual(['routine-2', 'routine-3']);
    await expect(api.listAiRoutines('ai-1')).resolves.toHaveLength(2);
  });
});

describe('RoutinesSectionContent actions', () => {
  function idleActions(overrides: Partial<RoutineRowActions> = {}): {
    actions: RoutineRowActions;
    spies: Record<
      'onPause' | 'onResume' | 'onAskDelete' | 'onConfirmDelete' | 'onCancelDelete',
      ReturnType<typeof vi.fn>
    >;
  } {
    const spies = {
      onPause: vi.fn(),
      onResume: vi.fn(),
      onAskDelete: vi.fn(),
      onConfirmDelete: vi.fn(),
      onCancelDelete: vi.fn(),
    };
    return { actions: { busyId: null, confirmingId: null, ...spies, ...overrides }, spies };
  }

  async function readyState(): Promise<RoutinesSectionState> {
    return {
      status: 'ready',
      routines: await createMockToolsApi().listAiRoutines('ai-1'),
      message: '',
    };
  }

  interface ActionButtonProps {
    accessibilityLabel?: string;
    disabled?: boolean;
    onPress?: () => void;
    children?: ReactNode;
  }

  type ActionButton = ReactElement<ActionButtonProps>;

  function buttonsIn(node: ReactNode, found: ActionButton[] = []): ActionButton[] {
    Children.forEach(node, (child) => {
      if (!isValidElement<ActionButtonProps>(child)) return;
      if (typeof child.type === 'function') {
        const Component = child.type as (props: object) => ReactNode;
        buttonsIn(Component(child.props), found);
        return;
      }
      if (child.type === 'Button') {
        found.push(child);
        return;
      }
      buttonsIn(child.props.children, found);
    });
    return found;
  }

  async function rowButtons(title: string, actions: RoutineRowActions): Promise<ActionButton[]> {
    const state = await readyState();
    const tree = RoutinesSectionContent({ state, onRetry: () => {}, actions });
    const rows = buttonsIn(tree).filter((button) => {
      const label = button.props.accessibilityLabel ?? '';
      return label.endsWith(title);
    });
    return rows;
  }

  function labelOf(button: ActionButton): string | undefined {
    return button.props.accessibilityLabel;
  }

  it('offers Pause on the active row and Resume on the paused rows', async () => {
    const state = await readyState();
    const { actions } = idleActions();
    const html = renderToStaticMarkup(
      createElement(RoutinesSectionContent, { state, onRetry: () => {}, actions }),
    );
    expect(html).toContain('Pause Weekday briefing');
    expect(html).toContain('Resume Hourly drafts');
    expect(html).toContain('Resume Hosts changed digest');
    expect(html).toContain('Delete Weekday briefing');
  });

  it('wires Pause and Resume to the row id', async () => {
    const { actions, spies } = idleActions();
    const pauseButtons = await rowButtons('Weekday briefing', actions);
    const pause = pauseButtons.find((button) => labelOf(button)?.startsWith('Pause'));
    pause?.props.onPress?.();
    expect(spies.onPause).toHaveBeenCalledWith('routine-1');
    expect(spies.onResume).not.toHaveBeenCalled();

    const resumeButtons = await rowButtons('Hourly drafts', actions);
    const resume = resumeButtons.find((button) => labelOf(button)?.startsWith('Resume'));
    resume?.props.onPress?.();
    expect(spies.onResume).toHaveBeenCalledWith('routine-2');
  });

  it('disables every action button while one runs and renames the busy one', async () => {
    const state = await readyState();
    for (const [busyId, busyText] of [
      ['routine-1', 'Pausing…'],
      ['routine-2', 'Resuming…'],
    ] as const) {
      const { actions } = idleActions({ busyId });
      const html = renderToStaticMarkup(
        createElement(RoutinesSectionContent, { state, onRetry: () => {}, actions }),
      );
      expect(html).toContain(busyText);
      const tree = RoutinesSectionContent({ state, onRetry: () => {}, actions });
      for (const button of buttonsIn(tree)) {
        expect(button.props.disabled).toBe(true);
      }
    }
  });

  it('asks before deleting: Delete arms the confirm, Cancel backs out', async () => {
    const { actions, spies } = idleActions();
    const initial = await rowButtons('Weekday briefing', actions);
    expect(initial.some((button) => labelOf(button) === 'Confirm deleting Weekday briefing')).toBe(
      false,
    );
    initial.find((button) => labelOf(button) === 'Delete Weekday briefing')?.props.onPress?.();
    expect(spies.onAskDelete).toHaveBeenCalledWith('routine-1');

    const armed = idleActions({ confirmingId: 'routine-1' });
    const armedButtons = await rowButtons('Weekday briefing', armed.actions);
    expect(
      armedButtons.some((button) => labelOf(button) === 'Confirm deleting Weekday briefing'),
    ).toBe(true);
    const tree = RoutinesSectionContent({
      state: await readyState(),
      onRetry: () => {},
      actions: armed.actions,
    });
    const cancel = buttonsIn(tree).find((button) => labelOf(button) === undefined);
    if (cancel === undefined) throw new Error('expected a Cancel button');
    expect(renderToStaticMarkup(cancel)).toContain('Cancel');
    cancel.props.onPress?.();
    expect(armed.spies.onCancelDelete).toHaveBeenCalledTimes(1);
    expect(armed.spies.onConfirmDelete).not.toHaveBeenCalled();
  });

  it('wires the destructive confirm to the row id', async () => {
    const armed = idleActions({ confirmingId: 'routine-1' });
    const armedButtons = await rowButtons('Weekday briefing', armed.actions);
    armedButtons
      .find((button) => labelOf(button) === 'Confirm deleting Weekday briefing')
      ?.props.onPress?.();
    expect(armed.spies.onConfirmDelete).toHaveBeenCalledWith('routine-1');
  });

  it('shows Deleting… on the confirming row while the delete runs', async () => {
    const state = await readyState();
    const { actions } = idleActions({ busyId: 'routine-1', confirmingId: 'routine-1' });
    const html = renderToStaticMarkup(
      createElement(RoutinesSectionContent, {
        state,
        onRetry: () => {},
        actions,
      }),
    );
    expect(html).toContain('Deleting…');
  });

  it('renders the hint and the error lines under the list', async () => {
    const state = await readyState();
    const { actions: hintActions } = idleActions();
    const hint = renderToStaticMarkup(
      createElement(RoutinesSectionContent, {
        state,
        onRetry: () => {},
        actions: hintActions,
        action: { kind: 'hint', text: ROUTINE_NEEDS_APPROVAL_MESSAGE },
      }),
    );
    expect(hint).toContain(ROUTINE_NEEDS_APPROVAL_MESSAGE);

    const { actions: errorActions } = idleActions();
    const error = renderToStaticMarkup(
      createElement(RoutinesSectionContent, {
        state,
        onRetry: () => {},
        actions: errorActions,
        action: { kind: 'error', text: ROUTINE_FORBIDDEN_MESSAGE },
      }),
    );
    expect(error).toContain(ROUTINE_FORBIDDEN_MESSAGE);
  });
});
