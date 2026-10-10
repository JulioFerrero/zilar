// @vitest-environment jsdom
import { createElement, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import { createRequire } from 'node:module';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import MachinesScreen from '@/app/settings/machines';
import { MachinesApiError, type Machine } from '@/lib/machines-api';
import { waitForAct } from '@/test/wait';

// Interactive tests for Settings → Machines. The screen is mounted in jsdom
// with react-dom and its native primitives swapped for DOM elements, then the
// test clicks the same buttons a person taps (found by their accessibility
// labels) and waits for the request and the new text. Nothing here depends on
// how the screen holds its state, only on what it shows and calls.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const api = vi.hoisted(() => ({
  listMachines: vi.fn(),
  createPairingCode: vi.fn(),
  approveMachine: vi.fn(),
  denyMachine: vi.fn(),
  revokeMachine: vi.fn(),
  renameMachine: vi.fn(),
  deleteMachine: vi.fn(),
  setAiMachine: vi.fn(),
}));

const clipboard = vi.hoisted(() => ({ setStringAsync: vi.fn() }));

vi.mock('expo-router', async () => {
  const React = await import('react');
  return {
    useFocusEffect: (effect: () => void) => {
      React.useEffect(effect, [effect]);
    },
    useRouter: () => ({ back: () => {}, push: () => {} }),
  };
});

vi.mock('expo-clipboard', () => clipboard);

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Modal: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? React.createElement('div', null, children) : null,
    ScrollView: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
    View: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children),
  };
});

vi.mock('react-native-safe-area-context', async () => {
  const React = await import('react');
  return {
    SafeAreaView: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('lucide-react-native', () => ({
  Check: () => null,
  ChevronDown: () => null,
  ChevronLeft: () => null,
  ChevronUp: () => null,
  Copy: () => null,
  Plus: () => null,
  Server: () => null,
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/ui/button', async () => {
  const React = await import('react');
  return {
    Button: ({
      accessibilityLabel,
      disabled,
      onPress,
      children,
    }: {
      accessibilityLabel?: string;
      disabled?: boolean;
      onPress?: () => void;
      children?: ReactNode;
    }) =>
      React.createElement(
        'button',
        { 'aria-label': accessibilityLabel, disabled, onClick: onPress },
        children,
      ),
  };
});

vi.mock('@/components/ui/card', async () => {
  const React = await import('react');
  return {
    Card: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children),
    SectionLabel: ({ children }: { children?: ReactNode }) =>
      React.createElement('h2', null, children),
  };
});

vi.mock('@/components/ui/confirm-dialog', async () => {
  const React = await import('react');
  return {
    ConfirmDialog: ({
      visible,
      title,
      message,
      error,
      confirmLabel,
      confirmAccessibilityLabel,
      onCancel,
      onConfirm,
    }: {
      visible: boolean;
      title: string;
      message: string;
      error: string;
      confirmLabel: string;
      confirmAccessibilityLabel: string;
      onCancel: () => void;
      onConfirm: () => void;
    }) =>
      visible
        ? React.createElement(
            'div',
            null,
            React.createElement('h3', null, title),
            React.createElement('p', null, message),
            error !== '' ? React.createElement('p', null, error) : null,
            React.createElement(
              'button',
              { 'aria-label': confirmAccessibilityLabel, onClick: onConfirm },
              confirmLabel,
            ),
            React.createElement(
              'button',
              { 'aria-label': 'Cancel dialog', onClick: onCancel },
              'Cancel',
            ),
          )
        : null,
  };
});

vi.mock('@/components/ui/icon-button', async () => {
  const React = await import('react');
  return {
    IconButton: ({
      label,
      onPress,
      children,
    }: {
      label: string;
      onPress: () => void;
      children?: ReactNode;
    }) => React.createElement('button', { 'aria-label': label, onClick: onPress }, children),
  };
});

vi.mock('@/components/ui/state-message', async () => {
  const React = await import('react');
  return {
    StateMessage: ({
      title,
      action,
    }: {
      title: string;
      action?: { label: string; accessibilityLabel?: string; onPress: () => void };
    }) =>
      React.createElement(
        'div',
        null,
        React.createElement('p', null, title),
        action
          ? React.createElement(
              'button',
              { 'aria-label': action.accessibilityLabel ?? action.label, onClick: action.onPress },
              action.label,
            )
          : null,
      ),
  };
});

vi.mock('@/components/ui/text', async () => {
  const React = await import('react');
  return {
    Text: ({ children }: { children?: ReactNode }) => React.createElement('span', null, children),
  };
});

vi.mock('@/components/ui/text-field', async () => {
  const React = await import('react');
  return {
    TextField: ({
      accessibilityLabel,
      value,
      onChangeText,
    }: {
      accessibilityLabel?: string;
      value: string;
      onChangeText: (value: string) => void;
    }) =>
      React.createElement('input', {
        'aria-label': accessibilityLabel,
        value,
        onChange: (event: ChangeEvent<HTMLInputElement>) => onChangeText(event.target.value),
      }),
  };
});

vi.mock('@/components/machines/use-machines-api', () => ({
  useMachinesApi: () => ({ api, scenario: null }),
}));

vi.mock('@/lib/colors', () => ({
  ACCENT_FOREGROUND: '#0a0a0a',
  ICON: '#d4d4d4',
}));

const CREATED_AT = '2026-10-03T10:00:00.000Z';

function machine(overrides: Partial<Machine> & { id: string }): Machine {
  return {
    name: 'Machine',
    status: 'pending',
    os: 'macOS',
    osVersion: '15.0',
    arch: 'arm64',
    cpu: 'Apple M3',
    cores: 8,
    ramGb: 16,
    diskFreeGb: 120,
    drivers: [],
    fingerprint: 'fp',
    createdAt: CREATED_AT,
    approvedAt: null,
    lastSeenAt: null,
    ...overrides,
  };
}

const PENDING = machine({ id: 'm-pending', name: 'Laptop' });
const APPROVED = machine({ id: 'm-approved', name: 'Home server', status: 'approved' });
const REVOKED = machine({ id: 'm-revoked', name: 'Old box', status: 'revoked' });

const PAIRING = { code: 'ABCD-EFGH', expiresAt: '2026-10-09T12:00:00.000Z' };

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLElement | null = null;
let unmount: (() => void) | null = null;

afterEach(() => {
  if (unmount !== null) {
    const done = unmount;
    unmount = null;
    act(() => done());
  }
  container?.remove();
  container = null;
});

beforeEach(() => {
  vi.resetAllMocks();
  clipboard.setStringAsync.mockResolvedValue(undefined);
  api.listMachines.mockResolvedValue([PENDING, APPROVED, REVOKED]);
  api.createPairingCode.mockResolvedValue(PAIRING);
});

// Mounts the screen element; the returned root is torn down by afterEach.
async function mountScreen(): Promise<void> {
  const element: ReactElement = createElement(MachinesScreen);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  container = host;
  unmount = () => root.unmount();
  act(() => root.render(element));
  await until(() => !text().includes('Loading machines'));
}

function text(): string {
  return container?.textContent ?? '';
}

function button(label: string): HTMLButtonElement {
  const found = container?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) {
    throw new Error(`no button labelled "${label}"`);
  }
  return found;
}

function hasButton(label: string): boolean {
  return container?.querySelector(`button[aria-label="${label}"]`) != null;
}

function click(label: string): void {
  const target = button(label);
  act(() => target.click());
}

function typeInto(label: string, value: string): void {
  const input = container?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) {
    throw new Error(`no input labelled "${label}"`);
  }
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// Waits for the requests and state updates to land, a few ticks at a time.
async function until(check: () => boolean): Promise<void> {
  await waitForAct(check);
}

describe('MachinesScreen (interactive)', () => {
  it('lists pending, approved and revoked machines in their sections', async () => {
    await mountScreen();

    expect(text()).toContain('Waiting for approval');
    expect(text()).toContain('Laptop');
    expect(text()).toContain('Your machines');
    expect(text()).toContain('Home server');
    expect(text()).toContain('Revoked (1)');
    expect(text()).not.toContain('Old box');
  });

  it('shows the load error and retries the list', async () => {
    api.listMachines.mockRejectedValueOnce(new MachinesApiError(0, 'network_error', 'offline'));
    api.listMachines.mockResolvedValueOnce([PENDING]);

    await mountScreen();
    expect(text()).toContain('Could not reach the server.');

    click('Retry loading machines');
    await until(() => text().includes('Laptop'));
    expect(api.listMachines).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state and creates a pairing code from it', async () => {
    api.listMachines.mockResolvedValue([]);

    await mountScreen();
    expect(text()).toContain('No machines yet');

    click('Add a machine');
    await until(() => text().includes(PAIRING.code));
    expect(api.createPairingCode).toHaveBeenCalledTimes(1);
    expect(text()).toContain(`zilar-runner pair ${PAIRING.code}`);
  });

  it('copies the pairing code', async () => {
    api.listMachines.mockResolvedValue([]);

    await mountScreen();
    click('Add a machine');
    await until(() => text().includes(PAIRING.code));

    click('Copy pairing code');
    await until(() => text().includes('Copied'));
    expect(clipboard.setStringAsync).toHaveBeenCalledWith(PAIRING.code);
  });

  it('shows the pairing limit message when no code can be made', async () => {
    api.listMachines.mockResolvedValue([]);
    api.createPairingCode.mockRejectedValue(
      new MachinesApiError(429, 'pairing_code_limit', 'limit'),
    );

    await mountScreen();
    click('Add a machine');
    await until(() => text().includes('You already have unused pairing codes'));
    expect(button('Try again')).toBeDefined();
  });

  it('approves a pending machine and moves it to your machines', async () => {
    api.approveMachine.mockResolvedValue({ ...PENDING, status: 'approved' });

    await mountScreen();
    click('Approve Laptop');
    await until(() => hasButton('Rename Laptop'));

    expect(api.approveMachine).toHaveBeenCalledWith('m-pending');
    expect(text()).not.toContain('Waiting for approval');
  });

  it('shows an approve failure on the row and keeps it pending', async () => {
    api.approveMachine.mockRejectedValue(new MachinesApiError(409, 'invalid_transition', 'x'));

    await mountScreen();
    click('Approve Laptop');
    await until(() => text().includes('That machine changed. Reload the list and try again.'));

    expect(text()).toContain('Waiting for approval');
  });

  it('denies a pending machine and removes it', async () => {
    api.denyMachine.mockResolvedValue(undefined);

    await mountScreen();
    click('Deny Laptop');
    await until(() => !text().includes('Laptop'));

    expect(api.denyMachine).toHaveBeenCalledWith('m-pending');
  });

  it('renames an approved machine', async () => {
    api.renameMachine.mockResolvedValue({ ...APPROVED, name: 'Garage' });

    await mountScreen();
    click('Rename Home server');
    typeInto('Name for Home server', 'Garage');
    click('Save the new name');
    await until(() => text().includes('Garage'));

    expect(api.renameMachine).toHaveBeenCalledWith('m-approved', 'Garage');
  });

  it('refuses an empty name without sending a request', async () => {
    await mountScreen();
    click('Rename Home server');
    typeInto('Name for Home server', '   ');
    click('Save the new name');
    await until(() => text().includes('Give the machine a name.'));

    expect(api.renameMachine).not.toHaveBeenCalled();
  });

  it('revokes an approved machine after confirmation', async () => {
    api.revokeMachine.mockResolvedValue({ ...APPROVED, status: 'revoked' });

    await mountScreen();
    click('Revoke Home server');
    expect(text()).toContain('Revoke this machine?');
    click('Confirm revoke');
    await until(() => text().includes('Revoked (2)'));

    expect(api.revokeMachine).toHaveBeenCalledWith('m-approved');
  });

  it('keeps the revoke dialog open with the error when revoking fails', async () => {
    api.revokeMachine.mockRejectedValue(new MachinesApiError(404, 'not_found', 'gone'));

    await mountScreen();
    click('Revoke Home server');
    click('Confirm revoke');
    await until(() => text().includes('That machine no longer exists.'));

    expect(text()).toContain('Revoke this machine?');
  });

  it('deletes a revoked machine after confirmation', async () => {
    api.deleteMachine.mockResolvedValue(undefined);

    await mountScreen();
    click('Show revoked machines');
    click('Delete Old box');
    click('Confirm delete');
    await until(() => !text().includes('Revoked (1)'));

    expect(api.deleteMachine).toHaveBeenCalledWith('m-revoked');
  });

  it('shows the delete error from the server in the dialog', async () => {
    api.deleteMachine.mockRejectedValue(new MachinesApiError(409, 'revoke_first', 'x'));

    await mountScreen();
    click('Show revoked machines');
    click('Delete Old box');
    click('Confirm delete');
    await until(() => text().includes('Revoke the machine before deleting it.'));

    expect(text()).toContain('Delete this machine?');
  });
});
