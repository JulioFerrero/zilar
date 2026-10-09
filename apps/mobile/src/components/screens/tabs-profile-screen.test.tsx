// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProfileTabScreen from '@/app/(tabs)/profile';
import { ProfileApiError, type MyProfile } from '@/lib/profile-api';

// The Profile tab is rendered through `react-dom/client` (jsdom). The profile
// card is a stand-in that shows its props and exposes its handlers as
// buttons, so each test drives one photo or profile action.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const state = vi.hoisted(() => {
  const api = {
    getMe: vi.fn(),
    uploadAvatar: vi.fn(),
    removeAvatar: vi.fn(),
  };
  return {
    api,
    push: vi.fn(),
    token: vi.fn(),
    picker: { pickPicture: vi.fn() },
    uploader: { upload: vi.fn() },
    clipboard: { setStringAsync: vi.fn() },
    view: vi.fn<(props: unknown) => ReactNode>(() => null),
  };
});

vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(effect, [effect]);
    },
    useRouter: () => ({ push: state.push, back: () => {} }),
  };
});

vi.mock('expo-clipboard', () => state.clipboard);

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  return {
    View: ({ children }: { children?: ReactNode }) => h('div', null, children),
    ScrollView: ({ children }: { children?: ReactNode }) => h('div', null, children),
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/auth/RequireAuth', async () => {
  const { createElement: h } = await import('react');
  return {
    RequireAuth: ({ children }: { children?: ReactNode }) => h('div', null, children),
  };
});

vi.mock('@/components/profile/profile-view', () => ({
  ProfileView: state.view,
}));

vi.mock('@/components/settings/avatar-native', () => ({
  createPicturePicker: () => state.picker,
  createAvatarFileUploader: () => state.uploader,
}));

vi.mock('@/components/settings/profile-logic', () => ({
  friendlyAvatarError: (error: unknown) =>
    `friendly:${error instanceof Error ? error.message : 'unknown'}`,
}));

vi.mock('@/components/settings/use-profile-api', () => ({
  useProfileApi: () => ({ api: state.api }),
}));

vi.mock('@/components/ui/text', async () => {
  const { createElement: h } = await import('react');
  return {
    Text: ({ children }: { children?: ReactNode }) => h('span', null, children),
  };
});

vi.mock('@/components/ui/state-message', async () => {
  const { createElement: h } = await import('react');
  return {
    StateMessage: ({
      title,
      action,
    }: {
      title: string;
      action?: { label: string; onPress: () => void };
    }) =>
      h(
        'div',
        null,
        h('p', null, title),
        action === undefined
          ? null
          : h(
              'button',
              { type: 'button', 'data-action': 'retry', onClick: action.onPress },
              action.label,
            ),
      ),
  };
});

vi.mock('@/lib/session-token', () => ({
  getSessionToken: state.token,
}));

type ViewProps = {
  profile: MyProfile;
  token: string | undefined;
  photoEdit: {
    stagedUri?: string;
    busy: boolean;
    canRemove: boolean;
    onSave: () => void;
    onDiscard: () => void;
    onRemove: () => void;
  };
  onSetPhoto: () => void;
  onEditInfo: () => void;
  onCopyUsername: () => void;
};

// The stand-in card: it shows what the screen gives it and exposes the handlers.
state.view.mockImplementation((raw: unknown) => {
  const props = raw as ViewProps;
  const edit = props.photoEdit;
  const button = (action: string, onClick: () => void) =>
    createElement('button', { type: 'button', 'data-action': action, onClick });
  return createElement(
    'div',
    null,
    createElement(
      'span',
      null,
      `profile:${props.profile.name}:${props.profile.avatarUrl ?? 'none'}`,
    ),
    createElement('span', null, `token:${props.token ?? 'none'}`),
    createElement('span', null, `staged:${edit.stagedUri ?? 'none'}`),
    createElement('span', null, `canRemove:${String(edit.canRemove)}`),
    createElement('span', null, `busy:${String(edit.busy)}`),
    button('set-photo', props.onSetPhoto),
    button('save-photo', edit.onSave),
    button('discard-photo', edit.onDiscard),
    button('remove-photo', edit.onRemove),
    button('edit-info', props.onEditInfo),
    button('copy-username', props.onCopyUsername),
  );
});

let root: { render(node: ReactNode): void; unmount(): void } | undefined;
let container: HTMLDivElement | undefined;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(): Promise<void> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const node = createElement(ProfileTabScreen);
  await act(async () => {
    root?.render(node);
  });
  await settle();
}

function text(): string {
  return container?.textContent ?? '';
}

async function press(name: string): Promise<void> {
  const el = container?.querySelector<HTMLElement>(`[data-action="${name}"]`);
  if (el === null || el === undefined) {
    throw new Error(`no control named ${name}`);
  }
  await act(async () => {
    el.click();
  });
  await settle();
}

const ME: MyProfile = {
  id: 'me-1',
  email: 'ana@x.test',
  name: 'Ana',
  handle: 'ana',
};

const PICTURE = { uri: 'file:///a.jpg', mimeType: 'image/jpeg', width: 1, height: 1 };

afterEach(async () => {
  if (root !== undefined) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = undefined;
  container = undefined;
});

beforeEach(() => {
  vi.clearAllMocks();
  state.api.getMe.mockResolvedValue(ME);
  state.token.mockResolvedValue('tok-1');
  state.picker.pickPicture.mockResolvedValue({ status: 'cancelled' });
  state.uploader.upload.mockResolvedValue({ url: '/api/avatars/me-1' });
  state.api.uploadAvatar.mockResolvedValue({ url: '/api/avatars/me-1' });
  state.api.removeAvatar.mockResolvedValue(undefined);
  state.clipboard.setStringAsync.mockResolvedValue(undefined);
});

describe('Profile tab', () => {
  it('shows the loading message while the profile loads', async () => {
    state.api.getMe.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(text()).toContain('Loading…');
  });

  it('shows the profile and the session token once loaded', async () => {
    await mount();
    expect(text()).toContain('profile:Ana:none');
    expect(text()).toContain('token:tok-1');
    expect(text()).not.toContain('Loading…');
  });

  it('shows the load error and retries on request', async () => {
    state.api.getMe.mockRejectedValueOnce(new Error('offline'));
    await mount();
    expect(text()).toContain('Could not load your profile.');
    await press('retry');
    expect(state.api.getMe).toHaveBeenCalledTimes(2);
    expect(text()).toContain('profile:Ana:none');
  });

  it('stages the picked picture and shows it', async () => {
    state.picker.pickPicture.mockResolvedValueOnce({ status: 'picked', picture: PICTURE });
    await mount();
    await press('set-photo');
    expect(text()).toContain('staged:file:///a.jpg');
  });

  it('shows the picker message when the picture is refused', async () => {
    state.picker.pickPicture.mockResolvedValueOnce({ status: 'error', message: 'Too big' });
    await mount();
    await press('set-photo');
    expect(text()).toContain('Too big');
    expect(text()).toContain('staged:none');
  });

  it('shows the fixed message when picking throws', async () => {
    state.picker.pickPicture.mockRejectedValueOnce(new Error('native crash'));
    await mount();
    await press('set-photo');
    expect(text()).toContain('Could not pick that picture. Try again.');
    expect(text()).not.toContain('native crash');
  });

  it('uploads the staged picture and shows the saved one', async () => {
    state.picker.pickPicture.mockResolvedValueOnce({ status: 'picked', picture: PICTURE });
    await mount();
    await press('set-photo');
    await press('save-photo');
    expect(state.api.uploadAvatar).toHaveBeenCalledWith(
      'me-1',
      expect.any(Blob),
      expect.any(Function),
    );
    expect(text()).toContain('profile:Ana:/api/avatars/me-1');
    expect(text()).toContain('staged:none');
  });

  it('sends the upload with the session token', async () => {
    state.picker.pickPicture.mockResolvedValueOnce({ status: 'picked', picture: PICTURE });
    await mount();
    await press('set-photo');
    await press('save-photo');
    const uploader = state.api.uploadAvatar.mock.calls[0]?.[2] as (url: string) => Promise<unknown>;
    await expect(uploader('/api/avatars/me-1')).resolves.toEqual({ url: '/api/avatars/me-1' });
    expect(state.uploader.upload).toHaveBeenCalledWith(
      '/api/avatars/me-1',
      expect.objectContaining({ uri: 'file:///a.jpg' }),
      'tok-1',
    );
  });

  it('rejects an upload that has no session', async () => {
    state.token.mockResolvedValue(undefined);
    state.picker.pickPicture.mockResolvedValueOnce({ status: 'picked', picture: PICTURE });
    await mount();
    await press('set-photo');
    await press('save-photo');
    const uploader = state.api.uploadAvatar.mock.calls[0]?.[2] as (url: string) => Promise<unknown>;
    await expect(uploader('/api/avatars/me-1')).rejects.toBeInstanceOf(ProfileApiError);
    expect(state.uploader.upload).not.toHaveBeenCalled();
  });

  it('keeps the staged picture and shows the friendly message when the upload fails', async () => {
    state.picker.pickPicture.mockResolvedValueOnce({ status: 'picked', picture: PICTURE });
    state.api.uploadAvatar.mockRejectedValueOnce(new Error('too large'));
    await mount();
    await press('set-photo');
    await press('save-photo');
    expect(text()).toContain('friendly:too large');
    expect(text()).toContain('staged:file:///a.jpg');
  });

  it('drops the staged picture on discard', async () => {
    state.picker.pickPicture.mockResolvedValueOnce({ status: 'picked', picture: PICTURE });
    await mount();
    await press('set-photo');
    await press('discard-photo');
    expect(text()).toContain('staged:none');
  });

  it('removes the saved picture', async () => {
    state.api.getMe.mockResolvedValue({ ...ME, avatarUrl: '/api/avatars/me-1' });
    await mount();
    expect(text()).toContain('canRemove:true');
    await press('remove-photo');
    expect(state.api.removeAvatar).toHaveBeenCalledWith('me-1');
    expect(text()).toContain('canRemove:false');
  });

  it('shows the friendly message when removing fails', async () => {
    state.api.getMe.mockResolvedValue({ ...ME, avatarUrl: '/api/avatars/me-1' });
    state.api.removeAvatar.mockRejectedValueOnce(new Error('nope'));
    await mount();
    await press('remove-photo');
    expect(text()).toContain('friendly:nope');
    expect(text()).toContain('canRemove:true');
  });

  it('opens the profile editor from Edit info', async () => {
    await mount();
    await press('edit-info');
    expect(state.push).toHaveBeenCalledWith('/settings/profile');
  });

  it('copies the handle with an @ prefix', async () => {
    await mount();
    await press('copy-username');
    await settle();
    expect(state.clipboard.setStringAsync).toHaveBeenCalledWith('@ana');
  });
});
