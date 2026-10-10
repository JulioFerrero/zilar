// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import IntegrationsScreen from '@/app/settings/integrations';
import { IntegrationsApiError, type IntegrationsStatus } from '@/lib/integrations-api';

// `react-dom/client` ships no bundled types and mobile has no testing library,
// so the screen renders through a typed require handle (the media-sheet and
// use-action test pattern). Native primitives are DOM stand-ins: a Pressable
// press becomes a click, a TextField becomes an input.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

const api = vi.hoisted(() => ({
  getIntegrationsStatus: vi.fn(),
  saveTelegramBotToken: vi.fn(),
  removeTelegramBotToken: vi.fn(),
  saveEmailSettings: vi.fn(),
  getVoiceTranscriptionStatus: vi.fn(),
  saveVoiceTranscriptionSettings: vi.fn(),
  removeVoiceTranscriptionSettings: vi.fn(),
}));

vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (effect: () => void) => {
      useEffect(effect, [effect]);
    },
    useRouter: () => ({ back: () => {}, push: () => {} }),
  };
});

vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
    View: (props: { children?: ReactNode }) => createElement('div', null, props.children),
  };
});

vi.mock('lucide-react-native', () => ({
  Eye: () => null,
  EyeOff: () => null,
  Lock: () => null,
  Mail: () => null,
  Mic: () => null,
  Send: () => null,
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/integrations/use-integrations-api', () => ({
  useIntegrationsApi: () => ({ api, scenario: null }),
}));

vi.mock('@/components/settings/screen-shell', async () => {
  const { createElement } = await import('react');
  return {
    SettingsScreenShell: (props: { title: string; subtitle: string; children?: ReactNode }) =>
      createElement(
        'div',
        null,
        createElement('h1', null, props.title),
        createElement('p', null, props.subtitle),
        props.children,
      ),
  };
});

vi.mock('@/components/ui/button', async () => {
  const { createElement } = await import('react');
  return {
    Button: (props: {
      accessibilityLabel?: string;
      disabled?: boolean;
      onPress: () => void;
      children?: ReactNode;
    }) =>
      createElement(
        'button',
        {
          type: 'button',
          'aria-label': props.accessibilityLabel,
          disabled: props.disabled === true,
          onClick: () => props.onPress(),
        },
        props.children,
      ),
  };
});

vi.mock('@/components/ui/confirm-dialog', async () => {
  const { createElement } = await import('react');
  return {
    ConfirmDialog: (props: {
      visible: boolean;
      title: string;
      message: string;
      error: string;
      confirmLabel: string;
      busy: boolean;
      busyLabel: string;
      onCancel: () => void;
      onConfirm: () => void;
      confirmAccessibilityLabel?: string;
    }) =>
      props.visible
        ? createElement(
            'div',
            null,
            createElement('p', null, props.title),
            createElement('p', null, props.message),
            props.error !== '' ? createElement('span', { role: 'alert' }, props.error) : null,
            createElement(
              'button',
              {
                type: 'button',
                'aria-label': 'Cancel removing',
                disabled: props.busy,
                onClick: () => props.onCancel(),
              },
              'Cancel',
            ),
            createElement(
              'button',
              {
                type: 'button',
                'aria-label': props.confirmAccessibilityLabel,
                disabled: props.busy,
                onClick: () => props.onConfirm(),
              },
              props.busy ? props.busyLabel : props.confirmLabel,
            ),
          )
        : null,
  };
});

vi.mock('@/components/ui/state-message', async () => {
  const { createElement } = await import('react');
  return {
    StateMessage: (props: {
      title: string;
      action?: { label: string; accessibilityLabel?: string; onPress: () => void };
    }) =>
      createElement(
        'div',
        null,
        createElement('p', null, props.title),
        props.action
          ? createElement(
              'button',
              {
                type: 'button',
                'aria-label': props.action.accessibilityLabel ?? props.action.label,
                onClick: () => props.action?.onPress(),
              },
              props.action.label,
            )
          : null,
      ),
  };
});

vi.mock('@/components/ui/text', async () => {
  const { createElement } = await import('react');
  return {
    Text: (props: { accessibilityRole?: string; children?: ReactNode }) =>
      createElement('span', { role: props.accessibilityRole }, props.children),
  };
});

vi.mock('@/components/ui/text-field', async () => {
  const { createElement } = await import('react');
  return {
    TextField: (props: {
      value: string;
      onChangeText: (value: string) => void;
      accessibilityLabel?: string;
      secureTextEntry?: boolean;
      editable?: boolean;
      placeholder?: string;
    }) =>
      createElement('input', {
        value: props.value,
        'aria-label': props.accessibilityLabel,
        type: props.secureTextEntry === true ? 'password' : 'text',
        disabled: props.editable === false,
        placeholder: props.placeholder,
        onChange: (event: { target: { value: string } }) => props.onChangeText(event.target.value),
      }),
  };
});

vi.mock('@/lib/auth', () => ({
  API_URL: 'http://127.0.0.1:3188',
}));

vi.mock('@/lib/colors', () => ({
  ICON: '#d4d4d4',
}));

function status(overrides: Partial<IntegrationsStatus> = {}): IntegrationsStatus {
  return {
    telegram: { configured: false, source: null },
    email: { configured: false, source: null, from: null },
    voiceTranscription: { configured: false, baseUrl: null, model: null },
    canManage: true,
    ...overrides,
  };
}

const mounted: Array<() => void> = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.clearAllMocks();
  while (mounted.length > 0) {
    mounted.pop()?.();
  }
});

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  await act(async () => {
    root.render(createElement(IntegrationsScreen));
  });
  await settle();
  return container;
}

function find(container: HTMLElement, label: string, index = 0): HTMLElement {
  const matches = container.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`);
  const element = matches[index];
  if (element === undefined) {
    throw new Error(`no element labelled "${label}" at ${index}`);
  }
  return element;
}

function has(container: HTMLElement, label: string): boolean {
  return container.querySelector(`[aria-label="${label}"]`) !== null;
}

async function click(element: HTMLElement): Promise<void> {
  act(() => {
    element.click();
  });
  await settle();
}

async function typeInto(input: HTMLElement, text: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

describe('Settings → Integrations screen', () => {
  it('shows the three owner cards with their set-up state', async () => {
    api.getIntegrationsStatus.mockResolvedValue(
      status({ telegram: { configured: true, source: 'stored' } }),
    );
    const container = await mount();
    expect(container.textContent).toContain('Email');
    expect(container.textContent).toContain('Voice transcription');
    expect(container.textContent).toContain('Telegram bot');
    expect(container.textContent).toContain('Connected');
    expect(container.textContent).toContain('Not set up');
  });

  it('shows the owner sentence instead of the cards for a non-owner', async () => {
    api.getIntegrationsStatus.mockRejectedValue(new IntegrationsApiError(404, 'not_found', 'raw'));
    const container = await mount();
    expect(container.textContent).toContain('Only the server owner can change these settings.');
    expect(container.textContent).not.toContain('Telegram bot');
  });

  it('shows the load failure sentence and retries the load', async () => {
    api.getIntegrationsStatus
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(status());
    const container = await mount();
    expect(container.textContent).toContain('Could not load integrations.');
    await click(find(container, 'Retry loading integrations'));
    expect(api.getIntegrationsStatus).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Telegram bot');
  });

  it('says the email sender is managed by environment variables and hides its form', async () => {
    api.getIntegrationsStatus.mockResolvedValue(
      status({ email: { configured: true, source: 'env', from: 'Zilar <no-reply@mail.test>' } }),
    );
    const container = await mount();
    expect(container.textContent).toContain('Managed by environment');
    expect(container.textContent).toContain(
      'Email is managed by environment variables on this server.',
    );
    expect(has(container, 'From address')).toBe(false);
  });

  it('asks for the sender address before saving the email card', async () => {
    api.getIntegrationsStatus.mockResolvedValue(status());
    const container = await mount();
    await click(find(container, 'Save', 0));
    expect(container.textContent).toContain('Enter the sender address first.');
    expect(api.saveEmailSettings).not.toHaveBeenCalled();
  });

  it('saves the email card, shows the test-email line and clears the key', async () => {
    api.getIntegrationsStatus
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(
        status({ email: { configured: true, source: 'stored', from: 'Zilar <no-reply@x.test>' } }),
      );
    api.saveEmailSettings.mockResolvedValue(undefined);
    const container = await mount();
    await typeInto(find(container, 'From address'), 'Zilar <no-reply@x.test>');
    await typeInto(find(container, 'New Resend API key'), 're_test_key');
    await click(find(container, 'Save', 0));
    expect(api.saveEmailSettings).toHaveBeenCalledWith({
      from: 'Zilar <no-reply@x.test>',
      resendApiKey: 're_test_key',
    });
    expect(container.textContent).toContain('Saved. A test email is on its way to your address.');
    expect((find(container, 'New Resend API key') as HTMLInputElement).value).toBe('');
  });

  it('keeps the typed key and shows the sentence when the email save fails', async () => {
    api.getIntegrationsStatus.mockResolvedValue(status());
    api.saveEmailSettings.mockRejectedValue(
      new IntegrationsApiError(502, 'mail_send_failed', 'raw'),
    );
    const container = await mount();
    await typeInto(find(container, 'From address'), 'Zilar <no-reply@x.test>');
    await typeInto(find(container, 'New Resend API key'), 're_test_key');
    await click(find(container, 'Save', 0));
    expect(container.textContent).toContain(
      'The test email could not be sent. Check the Resend key and the sender address.',
    );
    expect((find(container, 'New Resend API key') as HTMLInputElement).value).toBe('re_test_key');
  });

  it('asks for the endpoint base URL before saving the voice card', async () => {
    api.getIntegrationsStatus.mockResolvedValue(status());
    const container = await mount();
    await click(find(container, 'Save', 1));
    expect(container.textContent).toContain('Enter the endpoint base URL first.');
    expect(api.saveVoiceTranscriptionSettings).not.toHaveBeenCalled();
  });

  it('asks for a confirm step before removing the Telegram token', async () => {
    api.getIntegrationsStatus
      .mockResolvedValueOnce(status({ telegram: { configured: true, source: 'stored' } }))
      .mockResolvedValueOnce(status());
    api.removeTelegramBotToken.mockResolvedValue(undefined);
    const container = await mount();
    await click(find(container, 'Remove'));
    expect(container.textContent).toContain('Remove the Telegram token?');
    expect(api.removeTelegramBotToken).not.toHaveBeenCalled();
    await click(find(container, 'Confirm remove'));
    expect(api.removeTelegramBotToken).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Remove the Telegram token?');
  });

  it('shows the fixed sentence for a rejected Telegram token and keeps it for retry', async () => {
    api.getIntegrationsStatus.mockResolvedValue(status());
    api.saveTelegramBotToken.mockRejectedValue(
      new IntegrationsApiError(400, 'invalid_token', 'raw'),
    );
    const container = await mount();
    await click(find(container, 'Save', 2));
    expect(container.textContent).toContain('Paste the bot token first.');
    await typeInto(find(container, 'Bot token'), '123456:ABC-test');
    await click(find(container, 'Save', 2));
    expect(api.saveTelegramBotToken).toHaveBeenCalledWith('123456:ABC-test');
    expect(container.textContent).toContain(
      'Telegram rejected the bot token. Check it and try again.',
    );
    expect((find(container, 'Bot token') as HTMLInputElement).value).toBe('123456:ABC-test');
  });
});
