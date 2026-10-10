// @vitest-environment jsdom
import { createElement, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import { createRequire } from 'node:module';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import ProfileSettingsScreen from '@/app/settings/profile';
import { ProfileApiError, type MyProfile } from '@/lib/profile-api';
import { settle, waitForAct } from '@/test/wait';

// Interactive tests for Settings → Profile. The screen is mounted in jsdom
// with react-dom and its native parts swapped for DOM elements; the test
// types and clicks through the labels a person sees, then waits for the
// request and the new text. Native pickers, the avatar uploader and the
// session store are stubbed at their module edges.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  checkHandle: vi.fn(),
  claimHandle: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
}));

const store = vi.hoisted(() => ({ setName: vi.fn() }));

const picker = vi.hoisted(() => ({ pickPicture: vi.fn() }));

const uploader = vi.hoisted(() => ({ upload: vi.fn() }));

vi.mock('expo-router', async () => {
  const React = await import('react');
  return {
    useFocusEffect: (effect: () => void) => {
      React.useEffect(effect, [effect]);
    },
    useRouter: () => ({ back: () => {}, push: () => {} }),
  };
});

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    View: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children),
  };
});

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/auth/session', () => ({
  useAuthStore: (selector: (state: { setName: typeof store.setName }) => unknown) =>
    selector({ setName: store.setName }),
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: () => Promise.resolve('token-1'),
}));

vi.mock('@/components/settings/use-profile-api', () => ({
  useProfileApi: () => ({ api, scenario: null }),
}));

vi.mock('@/components/settings/avatar-native', () => ({
  createPicturePicker: () => picker,
  createAvatarFileUploader: () => uploader,
}));

vi.mock('@/components/settings/screen-shell', async () => {
  const React = await import('react');
  return {
    SettingsScreenShell: ({ title, children }: { title: string; children?: ReactNode }) =>
      React.createElement('div', null, React.createElement('h1', null, title), children),
  };
});

vi.mock('@/components/settings/avatar-control', async () => {
  const React = await import('react');
  return {
    AvatarControl: ({
      phase,
      currentUrl,
      onPick,
      onSavePicked,
      onRemove,
    }: {
      phase: { name: string; message?: string };
      currentUrl?: string;
      onPick: () => void;
      onSavePicked: () => void;
      onRemove: () => void;
    }) =>
      React.createElement(
        'div',
        null,
        React.createElement(
          'span',
          { 'data-phase': phase.name },
          phase.name === 'failed' ? phase.message : '',
        ),
        React.createElement('span', { 'data-avatar': currentUrl ?? 'none' }),
        React.createElement('button', { 'aria-label': 'Pick picture', onClick: onPick }, 'Pick'),
        React.createElement(
          'button',
          { 'aria-label': 'Save picture', onClick: onSavePicked },
          'Save',
        ),
        React.createElement(
          'button',
          { 'aria-label': 'Remove picture', onClick: onRemove },
          'Remove',
        ),
      ),
  };
});

vi.mock('@/components/settings/handle-field', async () => {
  const React = await import('react');
  return {
    HandleField: ({
      value,
      availability,
      error,
      saved,
      busy,
      saveDisabled,
      onChange,
      onSave,
    }: {
      value: string;
      availability: { state: string };
      error?: string;
      saved: boolean;
      busy: boolean;
      saveDisabled: boolean;
      onChange: (value: string) => void;
      onSave: () => void;
    }) =>
      React.createElement(
        'div',
        null,
        React.createElement('input', {
          'aria-label': 'Username',
          value,
          onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
        }),
        React.createElement('span', { 'data-state': availability.state }),
        error !== undefined ? React.createElement('p', null, error) : null,
        saved ? React.createElement('p', null, 'Saved.') : null,
        React.createElement(
          'button',
          { 'aria-label': 'Save username', disabled: saveDisabled || busy, onClick: onSave },
          'Save username',
        ),
      ),
  };
});

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

vi.mock('@/components/ui/state-message', async () => {
  const React = await import('react');
  return {
    StateMessage: ({
      title,
      action,
    }: {
      title: string;
      action?: { label: string; onPress: () => void };
    }) =>
      React.createElement(
        'div',
        null,
        React.createElement('p', null, title),
        action
          ? React.createElement(
              'button',
              { 'aria-label': action.label, onClick: action.onPress },
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

const ME: MyProfile = { id: 'u1', email: 'ada@example.com', name: 'Ada', handle: 'ada' };

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
  api.getMe.mockResolvedValue(ME);
  api.checkHandle.mockResolvedValue({ available: true });
  store.setName.mockResolvedValue({ ok: true });
  picker.pickPicture.mockResolvedValue({ status: 'cancelled' });
  api.removeAvatar.mockResolvedValue(undefined);
});

async function mountScreen(): Promise<void> {
  const element: ReactElement = createElement(ProfileSettingsScreen);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  container = host;
  unmount = () => root.unmount();
  act(() => root.render(element));
  await until(
    () => inputValue('Display name') !== null || text().includes('Could not load your profile.'),
  );
}

function text(): string {
  return container?.textContent ?? '';
}

function inputValue(label: string): string | null {
  const input = container?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  return input ? input.value : null;
}

function hasButton(label: string): boolean {
  return container?.querySelector(`button[aria-label="${label}"]`) != null;
}

function click(label: string): void {
  const target = container?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!target) {
    throw new Error(`no button labelled "${label}"`);
  }
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

describe('ProfileSettingsScreen (interactive)', () => {
  it('shows the display name and username of the signed-in user', async () => {
    await mountScreen();

    expect(inputValue('Display name')).toBe('Ada');
    expect(inputValue('Username')).toBe('ada');
    expect(api.getMe).toHaveBeenCalledTimes(1);
  });

  it('shows the load error and retries', async () => {
    api.getMe.mockRejectedValueOnce(new Error('offline'));

    await mountScreen();
    expect(text()).toContain('Could not load your profile.');

    click('Retry');
    await until(() => inputValue('Display name') === 'Ada');
    expect(api.getMe).toHaveBeenCalledTimes(2);
  });

  it('saves a new display name', async () => {
    await mountScreen();
    typeInto('Display name', '  Grace  ');
    click('Save name');
    await until(() => text().includes('Saved.'));

    expect(store.setName).toHaveBeenCalledWith('Grace');
  });

  it('refuses an empty display name without sending a request', async () => {
    await mountScreen();
    typeInto('Display name', '   ');
    click('Save name');
    await until(() => text().includes('Enter your name'));

    expect(store.setName).not.toHaveBeenCalled();
  });

  it('shows the name error when the store reports a failure', async () => {
    store.setName.mockResolvedValue({ ok: false });

    await mountScreen();
    typeInto('Display name', 'Grace');
    click('Save name');
    await until(() => text().includes('Could not save your name. Try again.'));
  });

  it('shows the same name error when the save throws', async () => {
    store.setName.mockRejectedValue(new Error('boom'));

    await mountScreen();
    typeInto('Display name', 'Grace');
    click('Save name');
    await until(() => text().includes('Could not save your name. Try again.'));
  });

  it('checks a new username after a short pause', async () => {
    await mountScreen();
    typeInto('Username', 'grace');
    await until(() => api.checkHandle.mock.calls.length > 0);

    expect(api.checkHandle).toHaveBeenCalledWith('grace');
    await until(() => container?.querySelector('[data-state="available"]') != null);
  });

  it('claims a new username', async () => {
    api.claimHandle.mockResolvedValue({ handle: 'grace' });

    await mountScreen();
    typeInto('Username', 'grace');
    click('Save username');
    await until(() => text().includes('Saved.'));

    expect(api.claimHandle).toHaveBeenCalledWith('grace');
  });

  it('shows the username error when the claim is refused', async () => {
    api.claimHandle.mockRejectedValue(new ProfileApiError(409, 'handle_taken', 'taken'));

    await mountScreen();
    typeInto('Username', 'grace');
    click('Save username');
    await until(() => text().includes('That username was just taken. Try another.'));
  });

  it('removes the profile picture', async () => {
    await mountScreen();
    click('Remove picture');
    await until(() => container?.querySelector('[data-phase="removed"]') != null);

    expect(api.removeAvatar).toHaveBeenCalledWith('u1');
  });

  it('picks a picture and uploads it', async () => {
    picker.pickPicture.mockResolvedValue({
      status: 'picked',
      picture: { uri: 'file:///photo.jpg', mimeType: 'image/jpeg' },
    });
    api.uploadAvatar.mockResolvedValue({ url: '/api/avatars/u1' });

    await mountScreen();
    click('Pick picture');
    await until(() => container?.querySelector('[data-phase="picked"]') != null);

    click('Save picture');
    await until(() => container?.querySelector('[data-avatar="/api/avatars/u1"]') != null);

    expect(api.uploadAvatar).toHaveBeenCalledWith('u1', expect.any(Blob), expect.any(Function));
    expect(container?.querySelector('[data-phase="idle"]')).not.toBeNull();
  });

  it('shows the picture error when the upload is refused', async () => {
    picker.pickPicture.mockResolvedValue({
      status: 'picked',
      picture: { uri: 'file:///photo.jpg', mimeType: 'image/jpeg' },
    });
    api.uploadAvatar.mockRejectedValue(new ProfileApiError(422, 'avatar_not_square', 'x'));

    await mountScreen();
    click('Pick picture');
    await until(() => container?.querySelector('[data-phase="picked"]') != null);
    click('Save picture');
    await until(() => text().includes('The picture must be square.'));
  });

  it('keeps the screen usable when the picker is cancelled', async () => {
    await mountScreen();
    click('Pick picture');
    await until(() => picker.pickPicture.mock.calls.length > 0);
    await settle();

    expect(container?.querySelector('[data-phase="idle"]')).not.toBeNull();
    expect(hasButton('Save username')).toBe(true);
  });
});
